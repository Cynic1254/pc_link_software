import {createRestAPIClient, type mastodon} from "masto";

export type MastodonClient = mastodon.rest.Client;

/**
 * One place where clients get created, so tokens never leak into the logic that uses them.
 * The fetcher is handed the admin client; the future write system can build its own
 * admin client and per-user clients (opt-in API keys) the same way.
 */
export function createClient(baseUrl: string, token: string): MastodonClient {
    return createRestAPIClient({ url: baseUrl, accessToken: token });
}