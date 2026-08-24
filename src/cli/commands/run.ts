import { getAdapter } from "../../adapters/registry.js";
import { runTurn } from "../../core/orchestrator.js";
import { SessionStore } from "../../core/session-store.js";
import { isAgentId, type AgentId, type PermissionLevel } from "../../core/types.js";
import { messages } from "../../ui/messages.js";
import { RunRenderer } from "../../ui/run-renderer.js";
import { EXIT } from "../exit-codes.js";

export interface RunCommandOptions {
  agent?: string;
  role?: string;
  chain?: string;
  auto?: boolean;
  unsafe?: boolean;
  relayOnError?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export async function runCommand(
  taskWords: string[],
  options: RunCommandOptions = {},
): Promise<void> {
  const task = taskWords.join(" ").trim();
  const renderer = new RunRenderer({
    ...(options.quiet !== undefined ? { quiet: options.quiet } : {}),
    ...(options.verbose !== undefined ? { verbose: options.verbose } : {}),
  });

  if (task === "") {
    renderer.fail(messages.emptyTask, 'baton run "describe the task"');
    process.exitCode = EXIT.usage;
    return;
  }

  if (options.agent !== undefined && !isAgentId(options.agent)) {
    renderer.fail(messages.unknownAgent(options.agent), "baton agents");
    process.exitCode = EXIT.usage;
    return;
  }

  // The router lands in M6; until then an explicit --agent or the chain head runs.
  const agentId: AgentId = isAgentId(options.agent ?? "") ? (options.agent as AgentId) : "claude";
  const adapter = getAdapter(agentId);
  const cwd = process.cwd();

  renderer.task(task);
  renderer.routerNote(
    messages.routerDecision(agentId, options.agent !== undefined ? "--agent" : "chain head"),
  );

  const detected = await adapter.detect();
  if (detected.verdict !== "ready") {
    renderer.fail(
      detected.verdict === "not_installed"
        ? messages.agentNotInstalled(agentId, detected.remedy ?? "")
        : `${agentId}: ${detected.detail ?? detected.verdict}`,
      detected.remedy,
    );
    process.exitCode = EXIT.error;
    return;
  }

  if (options.unsafe === true) renderer.warn(messages.unsafeWarning(agentId));

  const permissionLevel: PermissionLevel = options.auto === true ? "auto" : "safe";
  const store = await SessionStore.load(cwd);
  if (store.recovered) renderer.warn(messages.sessionRecovered);
  store.startTask(task);

  const controller = new AbortController();
  const onSigint = (): void => {
    controller.abort();
    process.exitCode = EXIT.cancelled;
  };
  process.once("SIGINT", onSigint);

  try {
    const outcome = await runTurn({
      adapter,
      prompt: task,
      cwd,
      permissionLevel,
      renderer,
      signal: controller.signal,
      ...(options.unsafe !== undefined ? { unsafe: options.unsafe } : {}),
      ...(options.verbose !== undefined ? { verbose: options.verbose } : {}),
    });

    store.appendTurn({
      ts: new Date().toISOString(),
      agent: outcome.agent,
      promptPreview: task,
      resultSummary: outcome.resultText,
      filesChanged: outcome.filesChanged,
      endedBy: outcome.endedBy,
      ...(outcome.usage !== undefined ? { usage: outcome.usage } : {}),
      ...(outcome.sessionRef !== undefined ? { sessionRef: outcome.sessionRef } : {}),
    });
    await store.save();

    switch (outcome.endedBy) {
      case "done":
        renderer.agentDone(outcome.agent, outcome.durationMs, outcome.filesChanged.length);
        process.exitCode = EXIT.ok;
        break;
      case "cancel":
        renderer.stop();
        renderer.warn(messages.cancelled);
        process.exitCode = EXIT.cancelled;
        break;
      case "limit":
        // The relay itself arrives in M5; for now be explicit about what happened.
        renderer.fail(
          messages.limitNoRelayYet(outcome.agent, outcome.limit?.resetHint),
          "baton continue",
        );
        process.exitCode = EXIT.exhausted;
        break;
      case "error":
        renderer.fail(
          messages.agentFailed(outcome.agent, outcome.error?.kind ?? "unknown"),
          outcome.error?.kind === "auth" ? `${outcome.agent}` : undefined,
        );
        if (outcome.error?.raw) renderer.note(outcome.error.raw.split("\n")[0] ?? "");
        process.exitCode = EXIT.error;
        break;
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    renderer.stop();
  }
}
