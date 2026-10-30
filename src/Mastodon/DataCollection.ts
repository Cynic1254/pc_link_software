import type {Account, AccountCore, ApiAccount, ApiStatus, InstanceInfo, Snapshot, Status} from "./types.js";
import TurndownService from "turndown";
import type {AccountClients} from "./AccountHandler.js";
import {DataReader} from "./Reader.js";
import {collectAttachments, extractQuote} from "./Helpers.js";


export class MastodonDataCollection {
    private readonly instance: InstanceInfo = {domain: "", title: "", description: ""};
    private readonly statuses = new Map<string, Status>();
    private readonly reblogs = new Map<string, Set<string>>();
    private readonly accounts = new Map<string, AccountCore>();
    private readonly accountStatuses = new Map<string, Set<string>>();

    private readonly markdown: TurndownService;
    private readonly client: AccountClients;

    private readonly instancePromise: Promise<void>;
    private readonly accountPromise: Promise<void>;

    constructor(client: AccountClients) {
        this.client = client;

        const reader = new DataReader(client);
        this.instancePromise = reader.GetInstanceInfo().then(instanceInfo => {
            this.instance.domain = instanceInfo.domain;
            this.instance.title = instanceInfo.title;
            this.instance.description = instanceInfo.description;
        });

        this.markdown = new TurndownService({
            headingStyle: "atx",
            codeBlockStyle: "fenced",
        });

        this.markdown.addRule("mastodon-invisible", {
            filter: (node) =>
                node.nodeName === "SPAN" && (node.getAttribute("class") ?? "").split(/\s+/).includes("invisible"),
            replacement: () => "",
        });

        this.accountPromise = reader.GetAccounts().then(async accounts => {
            await Promise.all(accounts.map(async (account) => {
                this.ParseAccount(account);
                const statuses = await reader.GetAccountStatuses(account.id);
                for (const status of statuses) this.ParseStatus(status, account);
            }));
        });

        //TODO: connect streaming client to keep statuses up to date
    }

    async GetSnapshot(): Promise<Snapshot> {
        await this.instancePromise;
        await this.accountPromise;

        const linkable = (id: string | undefined): id is string =>
            id !== undefined && this.statuses.has(id);

        const statuses: Record<string, Status> = {};
        for (const [id, status] of this.statuses) {
            const { reply, quote, ...rest } = status;
            const rebloggers = this.reblogs.get(id);
            statuses[id] = {
                ...rest,
                ...(linkable(reply) ? { reply } : {}),
                ...(linkable(quote) ? { quote } : {}),
                ...(rebloggers && rebloggers.size > 0 ? { reblog: [...rebloggers] } : {}),
            };
        }

        const accounts: Record<string, Account> = {};
        for (const [id, account] of this.accounts) {
            const ids = [...(this.accountStatuses.get(id) ?? [])];
            accounts[id] = { ...account, statuses: ids };
        }

        return {
            statuses,
            accounts,
            ...this.instance
        }
    }

    private ParseAccount(account: ApiAccount): string {
        if (!this.accounts.has(account.id)) {
            this.accounts.set(account.id, {
                username: account.username,
                display_name: account.displayName || account.username,
                about: this.markdown.turndown(account.note ?? ""),
                avatar: account.avatar,
                header: account.header,
                stats: {
                    follower_count: account.followersCount ?? 0,
                    following_count: account.followingCount ?? 0
                }
            });
            this.accountStatuses.set(account.id, new Set());
        }
        return account.id;
    }

    private ParseStatus(status: ApiStatus, sourceAccount: ApiAccount): string {
        if (!this.statuses.has(status.id)) {

            const attachments = collectAttachments(status);
            const quoteId = extractQuote(status);

            this.statuses.set(status.id, {
                account: status.account.id,
                content: {
                    content: this.markdown.turndown(status.content ?? ""),
                    ...(attachments.length > 0 ? {attachments} : {}),
                },
                stats: {
                    reblog_count: status.reblogsCount ?? 0,
                    favourite_count: status.favouritesCount ?? 0,
                    quotes_count: status.quotesCount ?? 0,
                    replies_count: status.repliesCount ?? 0,
                },
                ...(status.inReplyToId ? { reply: status.inReplyToId } : {}),
                ...(quoteId ? { quoteId: quoteId } : {}),
            });
            this.reblogs.set(status.id, new Set());
        }
        if (status.account.id !== sourceAccount.id) {
            this.reblogs.get(status.id)?.add(sourceAccount.id);
        }

        // always tries to add the status to the account, this is so in the case where we encounter a repost before the posting account we still index the status once we parse the posted account.
        this.accountStatuses.get(status.account.id)?.add(status.id);
        return status.id;
    }
}