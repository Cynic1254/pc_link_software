export interface ParsedCommand {
  /** The tag between the braces in the log line, e.g. "PCLink.JSON" or "PCLink.URL" */
  requestType: string;
  /** The raw string after "requestType}: " — not yet JSON-parsed */
  rawPayload: string;
  /** When this line was read (not VRChat's own log timestamp) */
  timestamp: Date;
  /** Path of the log file this came from — useful once session rotation is in play */
  sourceFile: string;
}

/**
 * A handler receives the already-JSON-parsed payload plus the raw command
 * metadata, in case it needs the source file or original string for logging.
 */
export type CommandHandler = (
  payload: unknown,
  meta: ParsedCommand
) => void | Promise<void>;
