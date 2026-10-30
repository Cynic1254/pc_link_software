import {z} from "zod";
import {createRestAPIClient, type mastodon} from "masto";
import {readFileSync} from "node:fs";

type Client = mastodon.rest.Client;

const JsonScheme = z.record(
    z.string(),
    z.string()
)

function loadAccounts(path: string | undefined): Map<string, string> {
    if (!path) throw new Error("path is required");

    return new Map(
        Object.entries(JsonScheme.parse(JSON.parse(readFileSync(path, "utf-8")))),
    );
}

export type AccountClients = ((account: string) => Client) & Client;

export function createClients(
    url: string,
    path = process.env.ACCOUNTS_FILE,
    defaultAccount = "admin"
): AccountClients {
    const tokens = loadAccounts(path);
    if (!tokens.has(defaultAccount)) throw new Error(`Default account "${defaultAccount}" not found in ${path}`);

    const cache = new Map<string, Client>();

    const get = (account: string) => {
        let client = cache.get(account);
        if (!client) {
            const accessToken = tokens.get(account);
            if (!accessToken) throw new Error(`No token for account "${account}"`)
            client = createRestAPIClient({ url, accessToken});
            cache.set(account, client);
        }
        return client;
    };

    return new Proxy(get, {
        get: (_t, prop) => Reflect.get(get(defaultAccount), prop),
    }) as AccountClients;
}