import {z} from "zod";

const uniqueStrings = (item: z.ZodString | z.ZodURL) =>
    z
        .array(item)
        .refine((a) => new Set(a).size === a.length, "items must be unique");

export const MessageStatsSchema = z.object({
    reblog_count: z.number(),
    favourite_count: z.number(),
    quotes_count: z.number(),
    replies_count: z.number(),
});

export const ContentSchema = z.object({
    /** Markdown text of the status */
    content: z.string().optional(),
    attachments: uniqueStrings(z.url()).optional(),
});

export const StatusSchema = z.object({
    /** The account that authored this status */
    account: z.string(),
    content: ContentSchema,
    stats: MessageStatsSchema,
    reply: z.string().optional(),
    /** IDs of the accounts that reblogged this status (omitted when nobody did) */
    reblog: uniqueStrings(z.string()).optional(),
    quote: z.string().optional(),
});

export const AccountStatsSchema = z.object({
    follower_count: z.number(),
    following_count: z.number(),
});

export const AccountSchema = z.object({
    /** username@domain */
    username: z.string(),
    display_name: z.string(),
    about: z.string(),
    avatar: z.url(),
    header: z.url(),
    stats: AccountStatsSchema,
    /** Statuses this account authored or reblogged. A reblog is a status whose `account` is someone else. */
    statuses: uniqueStrings(z.string()),
});

export const SnapshotSchema = z.object({
    statuses: z.record(z.string(), StatusSchema),
    accounts: z.record(z.string(), AccountSchema),
    domain: z.string(),
    title: z.string(),
    description: z.string(),
});

export type Status = z.infer<typeof StatusSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;