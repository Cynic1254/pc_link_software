import {type mastodon} from "masto";


type ApiStatus = mastodon.v1.Status;

function isUrl(value: string): boolean {
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

export function collectAttachments(s: ApiStatus): string[] {
    const urls = s.mediaAttachments
        .map((m) => m.url ?? m.remoteUrl ?? m.previewUrl)
        .filter((u): u is string => typeof u === "string" && isUrl(u));
    return [...new Set(urls)];
}

/**
 * Quote support differs by server:
 *  - Mastodon 4.5+: `quote: { state, quotedStatus }` (or only `quotedStatusId` for shallow quotes)
 *  - Glitch/Fedibird-style forks: `quote` is a full status object
 */
export function extractQuote(
    s: ApiStatus,
): { id: string; status?: ApiStatus } | undefined {
    const q = (s as unknown as { quote?: unknown }).quote;
    if (!q || typeof q !== "object") return undefined;

    const o = q as {
        id?: string;
        content?: string;
        quotedStatus?: ApiStatus | null;
        quotedStatusId?: string | null;
    };

    if (o.quotedStatus) return { id: o.quotedStatus.id, status: o.quotedStatus };
    if (o.quotedStatusId) return { id: o.quotedStatusId };
    if (o.id && o.content !== undefined) return { id: o.id, status: q as ApiStatus };
    return undefined;
}

/** Like Promise.all(items.map(fn)), but with at most `limit` calls in flight. */
export async function mapLimit<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;

    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i] as T);
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker),
    );
    return results;
}