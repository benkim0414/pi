import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerOutputStylesSession } from "./session.js";

export default function extension(pi: ExtensionAPI): void {
	registerOutputStylesSession(pi);
}
