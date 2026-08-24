import type { TaskResult } from "../../core/failover.js";
import type { AgentId } from "../../core/types.js";
import { messages } from "../../ui/messages.js";
import type { RunRenderer } from "../../ui/run-renderer.js";
import { EXIT } from "../exit-codes.js";

/** One place turns a TaskResult into what the user sees and the exit code they get. */
export function finishRun(
  renderer: RunRenderer,
  result: TaskResult,
  startAgent: AgentId,
): void {
  const last = result.outcomes.at(-1);
  switch (result.status) {
    case "done":
      renderer.agentDone(
        last?.agent ?? startAgent,
        last?.durationMs ?? 0,
        last?.filesChanged.length ?? 0,
      );
      process.exitCode = EXIT.ok;
      return;
    case "cancel":
      renderer.stop();
      renderer.warn(messages.cancelled);
      process.exitCode = EXIT.cancelled;
      return;
    case "exhausted":
      renderer.fail(messages.allAgentsExhausted, "baton status");
      for (const blocked of result.blocked) {
        renderer.note(messages.blockedAgent(blocked.agent, blocked.reason, blocked.until));
      }
      process.exitCode = EXIT.exhausted;
      return;
    case "error":
      renderer.fail(
        messages.agentFailed(last?.agent ?? startAgent, last?.error?.kind ?? "unknown"),
        last?.error?.kind === "auth" ? `${last?.agent}` : undefined,
      );
      if (last?.error?.raw) renderer.note(last.error.raw.split("\n")[0] ?? "");
      process.exitCode = EXIT.error;
  }
}
