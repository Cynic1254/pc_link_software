import type {mastodon} from "masto";
import type {MastodonClient} from "./Client.js";
import type {InstanceInfo} from "./Collector.js";
import type {RequestPacer} from "./RequestPacer.js";

type ApiStatus = mastodon.v1.Status;
type ApiAccount = mastodon.v1.Account;

const FEED_PAGE_SIZE = 40;      // Mastodon's maximum for account statuses
const ADMIN_PAGE_SIZE = 200;    // Mastodon's maximum for the admin account list
const STATUS_BATCH_SIZE = 20;   // the docs don't state a maximum for /statuses?id[]=, so stay modest

/**
 * Everything that talks to the server. Knows which endpoints to use and how to page through
 * them, paces every request, and hands out plain Mastodon entities. It doesn't know what a
 * snapshot is.
 *
 * Endpoint choices (the server is local-only, so everything we need lives on it):
 *   admin accounts   up to 200 accounts per request
 *   account feeds    40 entries per request, includes the account's own boosts
 *   statuses by id   one request resolves a batch of reply parents
 * Deliberately not used: /reblogged_by (every boost already shows up in the booster's feed),
 * public timelines (no boosts, public posts only) and anything that costs a request per status.
 */
export class MastodonSource {
    private readonly client: MastodonClient;
    private readonly pacer: RequestPacer;

    constructor(client: MastodonClient, pacer: RequestPacer) {
        this.client = client;
        this.pacer = pacer;
    }

    get requestCount(): number {
        return this.pacer.requestCount;
    }

    async instance(): Promise<InstanceInfo> {
        await this.pacer.acquire();
        try {
            const i = await this.client.v2.instance.fetch();
            return { domain: i.domain, title: i.title, description: i.description };
        } catch {
            // Servers older than Mastodon 4.0 don't have the v2 endpoint
            await this.pacer.acquire();
            const i = await this.client.v1.instance.fetch();
            return { domain: i.uri, title: i.title, description: i.description };
        }
    }

    /**
     * Every active local account (needs admin:read:accounts). Each entry is an Admin::Account
     * with email, IP and so on; only the public `.account` leaves this method.
     */
    async localAccounts(): Promise<ApiAccount[]> {
        const accounts: ApiAccount[] = [];
        const pages = this.client.v1.admin.accounts.list({
            local: true,
            active: true,
            limit: ADMIN_PAGE_SIZE,
        });
        for await (const page of this.paged(pages)) {
            for (const entry of page) accounts.push(entry.account);
        }
        return accounts;
    }

    /**
     * An account's own feed (posts, replies and boosts), newest first. Stops at `since`,
     * so the cost is about one request per 40 entries in the window.
     */
    async *accountFeed(accountId: string, since: Date | undefined): AsyncGenerator<ApiStatus> {
        const cutoff = since?.getTime();
        const pages = this.client.v1.accounts.$select(accountId).statuses.list({ limit: FEED_PAGE_SIZE });
        for await (const page of this.paged(pages)) {
            for (const status of page) {
                if (cutoff !== undefined && Date.parse(status.createdAt) < cutoff) return;
                yield status;
            }
        }
    }

    /** Fetches statuses by id in batches. Missing or inaccessible ones are just absent. */
    async statusesById(ids: readonly string[]): Promise<ApiStatus[]> {
        const found: ApiStatus[] = [];
        for (let i = 0; i < ids.length; i += STATUS_BATCH_SIZE) {
            await this.pacer.acquire();
            found.push(...(await this.client.v1.statuses.fetch({ id: ids.slice(i, i + STATUS_BATCH_SIZE) })));
        }
        return found;
    }

    /**
     * Iterates a masto paginator page by page, asking the pacer before each request.
     * The terminating next() (no Link header left) is counted too, so the request counter
     * is an upper bound.
     */
    private async *paged<T>(paginator: AsyncIterable<T[]>): AsyncGenerator<T[]> {
        const iterator = paginator[Symbol.asyncIterator]();
        try {
            for (;;) {
                await this.pacer.acquire();
                const result = await iterator.next();
                if (result.done || result.value.length === 0) return;
                yield result.value;
            }
        } finally {
            await iterator.return?.();
        }
    }
}