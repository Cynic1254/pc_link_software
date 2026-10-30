import type {AccountClients} from "./AccountHandler.js";
import type {ApiAccount, ApiStatus, InstanceInfo} from "./types.js";

export class DataReader {
    constructor(private readonly client: AccountClients) {

    }

    async GetAccounts(local: boolean = true, limit = 100): Promise<ApiAccount[]> {
        const accounts: ApiAccount[] = [];

        const pages = this.client.v1.admin.accounts.list({
            local,
            limit
        });

        for await (const page of this.paged(pages)) {
            for (const entry of page) accounts.push(entry.account);
        }
        return accounts;
    }

    async GetAccountStatuses(accountId: string, limit = 40): Promise<ApiStatus[]> {
        const statuses: ApiStatus[] = [];

        const pages = this.client.v1.accounts.$select(accountId).statuses.list({
            limit,
        });

        for await (const page of pages) {
            for (const entry of page) statuses.push(entry);
        }
        return statuses;
    }

    async GetInstanceInfo(): Promise<InstanceInfo> {
        try {
            return await this.client.v2.instance.fetch();
        } catch {
            const instance = await this.client.v1.instance.fetch();
            return {domain: instance.uri, ...instance};
        }
    }

    private async *paged<T>(paginator: AsyncIterable<T[]>): AsyncGenerator<T[]> {
        const iterator = paginator[Symbol.asyncIterator]();
        try {
            for (;;) {
                const result = await iterator.next();
                if (result.done || result.value.length === 0) return;
                yield result.value;
            }
        } finally {
            await iterator.return?.();
        }
    }
}