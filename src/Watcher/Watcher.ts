import {EventEmitter} from "node:events";
import type {Path} from "chokidar/handler.js";
import chokidar, {type FSWatcher} from "chokidar";
import {createReadStream, existsSync, statSync} from "node:fs";
import {readdir} from "node:fs/promises";
import {basename, join} from "node:path";


export class LogWatcher extends EventEmitter {
    private readonly logDir: Path;
    private watcher: FSWatcher | null = null;
    private activeFile: Path | null = null;
    private readOffset = 0;
    private buffer = "";

    constructor(directory: Path) {
        super();
        this.logDir = directory;
    }

    async start(): Promise<void> {
        if (!existsSync(this.logDir))
            throw new Error(`Log directory not found: ${this.logDir}`);

        const latest = await this.findLatestLogFile();
        if (latest)
            this.switchToFile(latest, false);

        this.watcher = chokidar.watch(this.logDir, {
            ignored: (path) => {
                if (path === this.logDir) return false;

                var temp = this.isLogFile(path);

                return !temp;
            },
            ignoreInitial: true,
            depth: 0,
            awaitWriteFinish: {stabilityThreshold: 200, pollInterval: 100}
        })

        this.watcher.on("add", (path) => {
            if (this.isLogFile(path))
                this.switchToFile(path, true);
        })
            .on("change", (path) => {
                if (path === this.activeFile)
                    this.readNewContent();
            })
            .on("error", (err) => this.emit("error", err));
    }

    async stop() {
        await this.watcher?.close();
    }

    private async findLatestLogFile(): Promise<Path | null> {
        const entries = await readdir(this.logDir);
        const logFiles = entries.filter(
            this.isLogFile
        );
        if (logFiles.length === 0) return null;

        let newest: { path: string; mtime: number } | null = null;
        for (const name of logFiles) {
            const path = join(this.logDir, name);
            const { mtimeMs } = statSync(path);
            if (!newest || mtimeMs > newest.mtime) {
                newest = { path, mtime: mtimeMs };
            }
        }
        return newest?.path ?? null;
    }

    private switchToFile(file: Path, fromStart: boolean): void {
        if (this.activeFile === file) return;

        this.activeFile = file;
        this.buffer = "";

        this.readOffset = fromStart ? 0 : statSync(file).size;
        this.emit("file-switch", file);
    }

    private readNewContent(): void {
        if (!this.activeFile) return;

        const {size} = statSync(this.activeFile);
        if (size <= this.readOffset) {
            if (size < this.readOffset) this.readOffset = 0;
            return;
        }

        const start = this.readOffset;
        const stream = createReadStream(this.activeFile, {
            start,
            end: size - 1,
            encoding: "utf-8"
        });

        stream.on("data", (chunk) => {
            this.buffer += chunk.toString();
            const lines = this.buffer.split(/\r?\n/);
            this.buffer = lines.pop() ?? "";
            for (const line of lines) {
                if (line.length > 0) this.emit("line", line, this.activeFile);
            }
        })
            .on("end", () => {
                this.readOffset = size;
            })
            .on("error", (err) => this.emit("error", err));
    }

    private isLogFile(file: Path): boolean {
        const name = basename(file);
        return name.startsWith("output_log_") && name.endsWith(".txt")
    }
}