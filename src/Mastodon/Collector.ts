import type {mastodon} from "masto";
import type {Account, Snapshot, Status} from "./types.js";
import {collectAttachments, extractQuote} from "./Helpers.js";

type ApiStatus = mastodon.v1.Status;
type ApiAccount = mastodon.v1.Account;
type AccountCore = Omit<Account, "statuses">;

export type Visibility = "public" | "unlisted" | "private" | "direct";

export interface InstanceInfo {
    domain: string;
    title: string;
    description: string;
}

/**
 * In-memory model of everything fetched so far. It never talks to the server; it only turns
 * Mastodon entities into snapshot entries and can emit a Snapshot for any subset of them.
 *
 * Boosts are not stored as statuses of their own: the original is stored once, the booster
 * is added to its `reblog` list, and the original is added to the booster's `statuses`.
 * The server is local-only, so the boosts found in the accounts' feeds are all there are.
 *
 * Only statuses whose visibility is in `visibilities` are ever stored. This matters because
 * a token also sees whatever its own account may see (followers-only posts, DMs), and none of
 * that may end up in a snapshot meant to be published.
 *
 * Snapshots are closed under references: a `reply` or `quote` is only emitted when its target
 * is part of the same snapshot, so consumers never meet an id that isn't in `statuses`.
 */
export class SnapshotCollector {
    private readonly instance: InstanceInfo;
    private readonly toMarkdown: (html: string) => string;
    private readonly visibilities: ReadonlySet<string>;

    private readonly statuses = new Map<string, Status>();
    /** status id -> ids of accounts that reblogged it */
    private readonly reblogs = new Map<string, Set<string>>();
    private readonly accounts = new Map<string, AccountCore>();
    /** account id -> ids of statuses it authored or reblogged */
    private readonly accountStatuses = new Map<string, Set<string>>();
    /** Accounts that were crawled directly; always kept, even with zero statuses */
    private readonly anchors = new Set<string>();
    /** status id -> unix ms of its latest activity (post time or most recent boost) */
    private readonly activity = new Map<string, number>();

    constructor(
        instance: InstanceInfo,
        toMarkdown: (html: string) => string,
        visibilities: ReadonlySet<Visibility>,
    ) {
        this.instance = instance;
        this.toMarkdown = toMarkdown;
        this.visibilities = visibilities;
    }

    /** Registers an account. `anchor` accounts are always part of the output. */
    addAccount(a: ApiAccount, anchor = false): string {
        if (!this.accounts.has(a.id)) {
            this.accounts.set(a.id, {
                // `acct` has no domain for local accounts, so add it
                username: a.acct.includes("@") ? a.acct : `${a.acct}@${this.instance.domain}`,
                display_name: a.displayName || a.username,
                about: this.toMarkdown(a.note ?? ""),
                avatar: a.avatar,
                header: a.header,
                stats: {
                    follower_count: a.followersCount ?? 0,
                    following_count: a.followingCount ?? 0,
                },
            });
            this.accountStatuses.set(a.id, new Set());
        }
        if (anchor) this.anchors.add(a.id);
        return a.id;
    }

    /**
     * Handles one entry of an account's feed. For a boost, the original status is stored and
     * `owner` is recorded as a reblogger; otherwise it's just a normal status.
     */
    addFeedItem(owner: ApiAccount, s: ApiStatus): void {
        const ownerId = this.addAccount(owner, true);
        // A followers-only boost would reveal who boosted what, so the boost itself is filtered too
        if (!this.isVisible(s)) return;

        if (!s.reblog) {
            this.addStatus(s);
            return;
        }

        const originalId = this.addStatus(s.reblog);
        if (originalId === undefined) return;
        this.recordReblog(originalId, ownerId);
        this.touch(originalId, Date.parse(s.createdAt));
    }

    /** Adds statuses that were fetched on their own (e.g. reply parents). */
    addStatuses(list: readonly ApiStatus[]): void {
        for (const s of list) this.addStatus(s);
    }

    /** Ids that stored statuses reply to or quote but that haven't been collected. */
    missingReferences(): string[] {
        const missing = new Set<string>();
        for (const s of this.statuses.values()) {
            for (const ref of [s.reply, s.quote]) {
                if (ref !== undefined && !this.statuses.has(ref)) missing.add(ref);
            }
        }
        return [...missing];
    }

    /**
     * Collected status ids, most recently active first. A reply parent or quoted status is
     * ranked as high as the newest status that points at it, so threads get pruned together.
     */
    idsByRecency(): string[] {
        const rank = new Map(this.activity);
        let changed = true;
        while (changed) {
            changed = false;
            for (const [id, s] of this.statuses) {
                const own = rank.get(id) ?? 0;
                for (const ref of [s.reply, s.quote]) {
                    if (ref !== undefined && this.statuses.has(ref) && (rank.get(ref) ?? 0) < own) {
                        rank.set(ref, own);
                        changed = true;
                    }
                }
            }
        }
        return [...this.statuses.keys()].sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0));
    }

    /**
     * Builds the snapshot, optionally restricted to the given status ids. Accounts that weren't
     * crawled directly are only included when they authored or reblogged a kept status.
     */
    snapshot(keep?: ReadonlySet<string>): Snapshot {
        const isKept = (id: string) => keep === undefined || keep.has(id);
        const linkable = (id: string | undefined): id is string =>
            id !== undefined && this.statuses.has(id) && isKept(id);

        const statuses: Record<string, Status> = {};
        const neededAccounts = new Set(this.anchors);

        for (const [id, status] of this.statuses) {
            if (!isKept(id)) continue;
            const { reply, quote, ...rest } = status;
            const rebloggers = this.reblogs.get(id);
            statuses[id] = {
                ...rest,
                ...(linkable(reply) ? { reply } : {}),
                ...(linkable(quote) ? { quote } : {}),
                ...(rebloggers && rebloggers.size > 0 ? { reblog: [...rebloggers] } : {}),
            };
            neededAccounts.add(status.account);
            for (const accountId of rebloggers ?? []) neededAccounts.add(accountId);
        }

        const accounts: Record<string, Account> = {};
        for (const id of neededAccounts) {
            const core = this.accounts.get(id);
            if (!core) continue;
            const ids = [...(this.accountStatuses.get(id) ?? [])]
                .filter(isKept)
                .sort((a, b) => (this.activity.get(b) ?? 0) - (this.activity.get(a) ?? 0));
            accounts[id] = { ...core, statuses: ids };
        }

        return {
            statuses,
            accounts,
            domain: this.instance.domain,
            title: this.instance.title,
            description: this.instance.description,
        };
    }

    /** Stores a status and anything it quotes. Returns its id, or undefined if it's filtered out. */
    private addStatus(s: ApiStatus): string | undefined {
        if (!this.isVisible(s)) return undefined;

        this.touch(s.id, Date.parse(s.createdAt));
        if (this.statuses.has(s.id)) return s.id;

        const accountId = this.addAccount(s.account);

        const quote = extractQuote(s);
        const quoteId = quote?.status ? this.addStatus(quote.status) : quote?.id;

        const attachments = collectAttachments(s);
        this.statuses.set(s.id, {
            account: accountId,
            content: {
                content: this.toMarkdown(s.content ?? ""),
                ...(attachments.length > 0 ? { attachments } : {}),
            },
            stats: {
                reblog_count: s.reblogsCount ?? 0,
                favourite_count: s.favouritesCount ?? 0,
                quotes_count: (s as unknown as { quotesCount?: number }).quotesCount ?? 0,
                replies_count: s.repliesCount ?? 0,
            },
            ...(s.inReplyToId ? { reply: s.inReplyToId } : {}),
            ...(quoteId ? { quote: quoteId } : {}),
        });
        this.accountStatuses.get(accountId)?.add(s.id);
        return s.id;
    }

    private recordReblog(statusId: string, accountId: string): void {
        let rebloggers = this.reblogs.get(statusId);
        if (!rebloggers) {
            rebloggers = new Set();
            this.reblogs.set(statusId, rebloggers);
        }
        rebloggers.add(accountId);
        this.accountStatuses.get(accountId)?.add(statusId);
    }

    private isVisible(s: ApiStatus): boolean {
        return this.visibilities.has(s.visibility);
    }

    private touch(id: string, ts: number): void {
        if (ts > (this.activity.get(id) ?? 0)) this.activity.set(id, ts);
    }
}