import { randomUUID } from "node:crypto";
import {
	Connection,
	localDaemon,
	openTerminal,
	type RemoteTerminal,
} from "@earendil-works/pi-env";

export interface ProcessInfo {
	id: string;
	pid: number;
	command: string;
	output: string;
	running: boolean;
	triggered: boolean;
	patterns: string[];
	code?: number;
	error?: string;
}

export function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

export class Processes {
	private connection?: Connection;
	private closed = false;
	private starting = 0;
	private readonly records = new Map<string, ProcessInfo>();
	private readonly terminals = new Map<string, RemoteTerminal>();

	constructor(private readonly changed: () => void) {}

	list(): ProcessInfo[] {
		return [...this.records.values()].map((record) => ({
			...record,
			patterns: [...record.patterns],
		}));
	}

	get(id: string): ProcessInfo {
		const record = this.records.get(id);
		if (!record) throw new Error("Unknown process session.");
		return record;
	}

	async start(
		command: string,
		cwd: string,
		patterns: string[] = [],
		signal?: AbortSignal,
	): Promise<ProcessInfo> {
		if (signal?.aborted) throw new Error("Process startup aborted.");
		if (this.closed) throw new Error("Process registry is closed.");
		if (process.platform === "win32")
			throw new Error("Background terminals require Linux or macOS.");
		if (!command.trim()) throw new Error("Command is empty.");
		if (this.records.size + this.starting >= 100)
			throw new Error(
				"Process history limit reached; reload after stopping processes.",
			);
		this.connection ??= new Connection({ command: [localDaemon()] });
		const record: ProcessInfo = {
			id: randomUUID(),
			pid: 0,
			command,
			output: "",
			running: true,
			triggered: false,
			patterns,
		};
		const decoder = new TextDecoder();

		const append = (text: string) => {
			record.output = (record.output + text).slice(-64000);
			if (
				!record.triggered &&
				patterns.some((pattern) => record.output.includes(pattern))
			) {
				record.triggered = true;
				if (!this.closed) this.changed();
			}
		};

		this.starting++;
		let terminal: RemoteTerminal;
		try {
			terminal = await openTerminal(this.connection, {
				cwd,
				argv: ["/bin/sh", "-c", command],
				cols: 120,
				rows: 30,
				onData: (bytes) => append(decoder.decode(bytes, { stream: true })),
			});
		} finally {
			this.starting--;
		}
		if (this.closed || signal?.aborted) {
			terminal.close();
			await terminal.exited.catch(() => {});
			throw new Error("Session closed or process startup aborted.");
		}
		record.pid = terminal.pid;
		this.records.set(record.id, record);
		this.terminals.set(record.id, terminal);
		void terminal.exited
			.then(
				(code) => {
					record.code = code;
				},
				(error) => {
					record.error = String(error);
				},
			)
			.finally(() => {
				append(decoder.decode());
				record.running = false;
				this.terminals.delete(record.id);
				if (!this.closed) this.changed();
			});
		return { ...record };
	}

	input(id: string, text: string): void {
		this.get(id);
		const terminal = this.terminals.get(id);
		if (!terminal) throw new Error("Process has exited.");
		terminal.write(text);
	}

	stop(id: string): void {
		this.get(id);
		this.terminals.get(id)?.close();
	}

	async close(): Promise<void> {
		this.closed = true;
		for (const terminal of this.terminals.values()) terminal.close();
		await this.connection?.close();
		this.terminals.clear();
	}
}
