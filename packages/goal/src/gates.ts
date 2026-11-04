import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export interface GateResult {
	code: number;
	output: string;
	killed: boolean;
}

/** Execute an explicitly registered gate with bounded output and process-group cleanup. */
export function runGate(
	command: string,
	cwd: string,
	signal: AbortSignal,
	timeout = 300000,
): Promise<GateResult> {
	if (signal.aborted) return Promise.reject(new Error("Gate aborted"));
	if (process.platform === "win32")
		return Promise.reject(new Error("Quality gates require Linux or macOS."));
	return new Promise((resolve, reject) => {
		let output = "";
		let killed = false;
		const child = spawn("/bin/sh", ["-c", command], {
			cwd,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdout = new StringDecoder("utf8");
		const stderr = new StringDecoder("utf8");

		const append = (text: string) => {
			output = (output + text).slice(-3000);
		};

		child.stdout.on("data", (bytes) => append(stdout.write(bytes)));

		child.stderr.on("data", (bytes) => append(stderr.write(bytes)));

		const stop = () => {
			killed = true;
			if (child.pid) {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {
					/* already exited */
				}
			}
		};

		const timer = setTimeout(stop, timeout);
		signal.addEventListener("abort", stop, { once: true });
		if (signal.aborted) stop();

		const cleanup = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", stop);
		};

		child.once("error", (error) => {
			cleanup();
			reject(error);
		});

		child.once("close", (code) => {
			cleanup();
			append(stdout.end());
			append(stderr.end());
			resolve({ code: code ?? -1, output, killed });
		});
	});
}
