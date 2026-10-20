import type {CommandBase} from "../Commands/CommandBase.js";
import type {ParsedCommand} from "../types.js";
import {LogWatcher} from "./Watcher.js";
import type {Path} from "chokidar/handler.js";


export class Dispatcher {
    private handlers = new Map<string, CommandBase>();
    private watcher: LogWatcher | null = null;

    register(command: CommandBase) {
        if (this.handlers.has(command.name)) {
            console.warn(`[dispatcher] overwriting existing handler for "${command.name}"`)
        }
        this.handlers.set(command.name, command);
    }

    async start(path: Path) {
        this.watcher = new LogWatcher(path);

        this.watcher.on("file-switch", (file: Path) => {
            console.log(`[watcher] now tailing: ${file}`);
        })
            .on("line", (line: string, file: Path) => {
                const command = this.parseLine(line, file);
                if (command) {
                    this.dispatch(command);
                }
            })
            .on("error", (err: Error) => {
                console.error("[watcher] error:", err);
            });

        await this.watcher.start();
        console.log("VRC console link watcher running. Waiting for commands...");
    }

    stop(): void {
        this.watcher?.stop();
        this.watcher = null;
    }

    private async dispatch(command: ParsedCommand): Promise<void> {
        const handler = this.handlers.get(command.requestType);
        if (!handler) {
            console.warn(
                `[dispatcher] no handler registered for "${command.requestType}", ignoring`
            );
            return;
        }

        try {
            const payload = JSON.parse(command.rawPayload);
            console.log(payload);
            handler.call(payload, command);
        } catch (error) {
            console.error(`[dispatcher] "${command.requestType}" payload was not valid JSON: `, error);
        }
    }

    private parseLine(line: string, sourceFile: string): ParsedCommand | null {
        const match = line.match(/\{(PCLink\.[^}]+)\}:\s*(.+)$/);
        if (!match) return null;

        const [, requestType, rawPayload] = match;
        if (!requestType || rawPayload === undefined) return null;

        return {
            requestType,
            rawPayload: rawPayload.trim(),
            timestamp: new Date(),
            sourceFile,
        };
    }
}