import { createInterface } from "node:readline/promises";
import { loadConfig } from "../../core/config.js";
import { readClaudeLocalHistory, readCodexLocalHistory } from "../../core/deep-history.js";
import { buildStatusReport } from "../../core/status.js";
import { UsageStore } from "../../core/usage-store.js";
import { messages } from "../../ui/messages.js";
import { renderStatus } from "../../ui/render.js";
import { isTTY, theme } from "../../ui/theme.js";
import { EXIT } from "../exit-codes.js";

export interface StatusCommandOptions {
  json?: boolean;
  deep?: boolean;
  reset?: boolean;
}

export async function statusCommand(options: StatusCommandOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const usage = await UsageStore.load();

  if (options.reset === true) {
    const confirmed = await confirmReset();
    if (!confirmed) {
      process.stdout.write(`${messages.statusResetKept}\n`);
      process.exitCode = EXIT.ok;
      return;
    }
    usage.clear();
    await usage.save();
    process.stdout.write(`${theme.success("✓")} ${messages.statusResetDone}\n`);
    process.exitCode = EXIT.ok;
    return;
  }

  const { config } = await loadConfig(cwd);
  const report = buildStatusReport(usage, {
    project: cwd,
    now: new Date(),
    cooldownMinutes: config.cooldownMinutes,
  });

  if (options.deep === true) {
    // Read-only, defensive, and entirely optional (docs/USAGE-TRACKING.md).
    const [claude, codex] = await Promise.all([
      readClaudeLocalHistory(),
      readCodexLocalHistory(),
    ]);
    for (const totals of [claude, codex]) {
      if (totals.entries === 0) continue;
      const agent = report.agents.find((entry) => entry.agent === totals.agent);
      if (agent !== undefined) {
        agent.deep = {
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
          entries: totals.entries,
        };
      }
    }
  }

  if (options.json === true) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = EXIT.ok;
    return;
  }

  process.stdout.write(renderStatus(report, { deep: options.deep === true }));
  process.exitCode = EXIT.ok;
}

async function confirmReset(): Promise<boolean> {
  if (!isTTY()) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(messages.statusResetConfirm)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
