import type {mastodon} from "masto";
import TurndownService from "turndown";
import {type Snapshot, SnapshotSchema} from "./types.js";
import {SnapshotCollector, type Visibility} from "./Collector.js";
import type {MastodonClient} from "./Client.js";
import {MastodonSource} from "./Source.js";
import {RequestPacer} from "./RequestPacer.js";
import {mapLimit} from "./Helpers.js";

type ApiAccount = mastodon.v1.Account;

/**
 * VRChat's string loader accepts up to 100 MB, but there's a user report of iOS
 * truncating strings from roughly 800 KB, so stay well under that by default.
 */
const DEFAULT_MAX_BYTES = 512 * 1024;

/** What an anonymous visitor could see: public posts and unlisted ones (reachable by link). */
const DEFAULT_VISIBILITIES: readonly Visibility[] = ["public", "unlisted"];

/** How many levels of reply parents to chase (parent of a parent, ...). */
const MAX_REFERENCE_ROUNDS = 5;

export interface BuildOptions {
    /**
     * Only crawl these accounts (usernames, without the domain). Filtering happens locally on
     * the admin account list, so it costs no extra requests. Default: every active local account.
     */
    accounts?: readonly string[];
    /**
     * Which statuses may end up in the snapshot. Default: public + unlisted.
     * The admin token's own account can also see followers-only posts and DMs, so this is
     * what keeps those out. Adding "private" or "direct" publishes them.
     */
    visibilities?: readonly Visibility[];
    /**
     * Only include activity (posts and boosts) since this date. Default: everything.
     * With a date every boost inside the window is guaranteed to be seen, because a boost can't
     * be older than the status it boosts. Set it on big servers: cost is ~1 request per 40 entries.
     */
    since?: Date;
    /**
     * Fetch reply parents (and other referenced statuses) that fall outside the window, in
     * batches, so the snapshot is self-contained. Default true.
     */
    resolveReferences?: boolean;
    /** Hard cap for the serialized JSON in UTF-8 bytes. Oldest statuses are dropped first. Default 512 KiB. */
    maxBytes?: number;
    /** Account feeds crawled in parallel. Default 4. */
    concurrency?: number;
}

export interface BuildResult {
    snapshot: Snapshot;
    /** Minified JSON, ready to be served */
    json: string;
    bytes: number;
    statusCount: number;
    /** Statuses that were collected but didn't fit in maxBytes */
    droppedStatuses: number;
    /** Requests spent on this build (an upper bound) */
    requests: number;
}

/**
 * Read-only: builds a snapshot of a local-only server, using as few requests as possible.
 * Hand it a client that uses the admin token.
 *
 * Scopes the token needs for this (as far as I know):
 *   admin:read:accounts  list the local accounts
 *   read:statuses        account feeds and statuses by id while authenticated
 * Anything that writes belongs to the write system and should use a different token.
 *
 * The pacer is injectable so everything that uses the same token can share one request budget.
 */
export class MastodonSnapshotBuilder {
    private readonly source: MastodonSource;
    private readonly markdown: TurndownService;

    constructor(client: MastodonClient, pacer: RequestPacer = new RequestPacer()) {
        this.source = new MastodonSource(client, pacer);

        this.markdown = new TurndownService({
            headingStyle: "atx",
            codeBlockStyle: "fenced",
        });
        // Mastodon wraps the unreadable parts of link text in <span class="invisible">
        this.markdown.addRule("mastodon-invisible", {
            filter: (node) =>
                node.nodeName === "SPAN" &&
                (node.getAttribute("class") ?? "").split(/\s+/).includes("invisible"),
            replacement: () => "",
        });
    }

    async build(options: BuildOptions = {}): Promise<BuildResult> {
        const {
            accounts,
            visibilities = DEFAULT_VISIBILITIES,
            since,
            resolveReferences = true,
            maxBytes = DEFAULT_MAX_BYTES,
            concurrency = 4,
        } = options;

        const requestsBefore = this.source.requestCount;

        const instance = await this.source.instance();
        const collector = new SnapshotCollector(
            instance,
            (html) => this.markdown.turndown(html),
            new Set(visibilities),
        );

        const roster = selectAccounts(await this.source.localAccounts(), accounts);
        if (roster.length === 0) throw new Error("No accounts found to crawl.");
        for (const account of roster) collector.addAccount(account, true);

        // The server is local-only, so the accounts' own feeds contain every boost there is
        await mapLimit(roster, concurrency, async (account) => {
            if (account.statusesCount === 0) return; // nothing to read, spare the request
            for await (const status of this.source.accountFeed(account.id, since)) {
                collector.addFeedItem(account, status);
            }
        });

        if (resolveReferences) await this.fetchMissingReferences(collector);

        const fit = this.fitToBudget(collector, maxBytes);
        return { ...fit, requests: this.source.requestCount - requestsBefore };
    }

    /* ------------------------------ internals ------------------------------- */

    /** Chases reply parents with batched lookups instead of one request per status. */
    private async fetchMissingReferences(collector: SnapshotCollector): Promise<void> {
        const attempted = new Set<string>();
        for (let round = 0; round < MAX_REFERENCE_ROUNDS; round++) {
            const missing = collector.missingReferences().filter((id) => !attempted.has(id));
            if (missing.length === 0) return;
            for (const id of missing) attempted.add(id);
            collector.addStatuses(await this.source.statusesById(missing));
        }
    }

    /** Keeps the newest statuses that fit in `maxBytes` (binary search on the status count). */
    private fitToBudget(collector: SnapshotCollector, maxBytes: number): Omit<BuildResult, "requests"> {
        const ordered = collector.idsByRecency();
        const measure = (n: number) =>
            Buffer.byteLength(JSON.stringify(collector.snapshot(new Set(ordered.slice(0, n)))), "utf8");

        let keep = ordered.length;
        if (measure(keep) > maxBytes) {
            if (measure(0) > maxBytes) {
                throw new Error(`The accounts alone exceed maxBytes (${maxBytes}).`);
            }
            let lo = 0;
            let hi = keep - 1;
            while (lo < hi) {
                const mid = Math.ceil((lo + hi) / 2);
                if (measure(mid) <= maxBytes) lo = mid;
                else hi = mid - 1;
            }
            keep = lo;
        }

        // Throws a ZodError if anything doesn't match the schema
        const snapshot = SnapshotSchema.parse(collector.snapshot(new Set(ordered.slice(0, keep))));
        const json = JSON.stringify(snapshot);
        return {
            snapshot,
            json,
            bytes: Buffer.byteLength(json, "utf8"),
            statusCount: keep,
            droppedStatuses: ordered.length - keep,
        };
    }
}

function selectAccounts(all: readonly ApiAccount[], usernames: readonly string[] | undefined): ApiAccount[] {
    if (!usernames || usernames.length === 0) return [...all];
    const wanted = new Set(usernames.map((u) => u.toLowerCase()));
    return all.filter((a) => wanted.has(a.username.toLowerCase()));
}