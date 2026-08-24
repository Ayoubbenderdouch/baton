import path from "node:path";
import { refreshHandoff } from "../../core/handoff-refresh.js";
import { SessionStore } from "../../core/session-store.js";
import { messages } from "../../ui/messages.js";
import { theme } from "../../ui/theme.js";
import { EXIT } from "../exit-codes.js";
import { DEFAULT_MAX_RELAYS } from "./run.js";

export async function handoffCommand(): Promise<void> {
  const cwd = process.cwd();
  const store = await SessionStore.load(cwd);
  const paths = await refreshHandoff(cwd, store, { maxRelays: DEFAULT_MAX_RELAYS });
  const relative = path.relative(cwd, paths.rootPath) || paths.rootPath;
  process.stdout.write(`${theme.success("✓")} ${messages.handoffWritten(relative)}\n`);
  if (store.session.turns.length === 0) {
    process.stdout.write(`${theme.dim(messages.handoffEmpty)}\n`);
  }
  process.exitCode = EXIT.ok;
}
