import path from "node:path";
import { loadConfig } from "../../core/config.js";
import { refreshHandoff } from "../../core/handoff-refresh.js";
import { SessionStore } from "../../core/session-store.js";
import { messages } from "../../ui/messages.js";
import { theme } from "../../ui/theme.js";
import { EXIT } from "../exit-codes.js";

export async function handoffCommand(): Promise<void> {
  const cwd = process.cwd();
  const store = await SessionStore.load(cwd);
  const { config } = await loadConfig(cwd);
  const paths = await refreshHandoff(cwd, store, { maxRelays: config.maxRelays });
  const relative = path.relative(cwd, paths.rootPath) || paths.rootPath;
  process.stdout.write(`${theme.success("✓")} ${messages.handoffWritten(relative)}\n`);
  if (store.session.turns.length === 0) {
    process.stdout.write(`${theme.dim(messages.handoffEmpty)}\n`);
  }
  process.exitCode = EXIT.ok;
}
