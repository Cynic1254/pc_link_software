import type {ParsedCommand} from "../types.js";


export interface CommandBase {
    name: string;

    call(payload: unknown, meta: ParsedCommand): void;
}