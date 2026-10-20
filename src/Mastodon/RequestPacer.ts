const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Keeps a token under Mastodon's per-account rate limit (300 requests per 5 minutes by
 * default) by delaying requests instead of letting the server answer 429.
 *
 * It is a plain object so several users of the same token (the fetcher now, the future
 * write system later) can share one instance and therefore one budget.
 */
export class RequestPacer {
    private readonly limit: number;
    private readonly windowMs: number;
    /** Timestamps of the requests that are still inside the window, oldest first */
    private readonly sent: number[] = [];
    private total = 0;

    /** @param limit requests allowed per window; stays below Mastodon's 300 by default */
    constructor(limit = 240, windowMs = 5 * 60_000) {
        this.limit = Math.max(1, limit);
        this.windowMs = windowMs;
    }

    /** Requests made through this pacer so far (an upper bound: see MastodonSource.paged). */
    get requestCount(): number {
        return this.total;
    }

    /** Resolves once one more request may be sent. */
    async acquire(): Promise<void> {
        for (;;) {
            const now = Date.now();

            let oldest = this.sent[0];
            while (oldest !== undefined && now - oldest >= this.windowMs) {
                this.sent.shift();
                oldest = this.sent[0];
            }

            if (this.sent.length < this.limit) {
                this.sent.push(now);
                this.total++;
                return;
            }

            // Window is full: wait until the oldest request drops out of it
            await sleep(this.windowMs - (now - (oldest ?? now)) + 1);
        }
    }
}