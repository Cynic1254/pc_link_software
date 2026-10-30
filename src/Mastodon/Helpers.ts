import type {ApiStatus} from "./types.js";

function isUrl(value: string): boolean {
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

export function collectAttachments(status: ApiStatus): string[] {
    const urls = status.mediaAttachments
        .map((media) => media.url ?? media.remoteUrl ?? media.previewUrl)
        .filter((url): url is string => typeof url === "string" && isUrl(url));
    return [...new Set(urls)];
}

export function extractQuote(
    status: ApiStatus
): string | null {
    const quote = status.quote;
    if (!quote || typeof quote !== "object") return null;

    const other = quote as {
        id?: string;
        content?: string;
        quotedStatus?: ApiStatus | null;
        quotedStatusId?: string | null;
    };

    if (other.quotedStatus) return other.quotedStatus.id;
    if (other.quotedStatusId) return other.quotedStatusId;
    if (other.id && other.content !== undefined) return other.id;
    return null;
}