import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGoalSession } from "./session.js";

export default function extension(pi: ExtensionAPI): void {
	registerGoalSession(pi);
}
