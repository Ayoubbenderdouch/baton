import { detectAll, getAdapter } from "../../adapters/registry.js";
import { loadConfig } from "../../core/config.js";
import { executeTask } from "../../core/execute.js";
import { refreshHandoff } from "../../core/handoff-refresh.js";
import { SessionStore } from "../../core/session-store.js";
import type { AgentId, DetectResult } from "../../core/types.js";
import { UsageStore } from "../../core/usage-store.js";
import { messages } from "../../ui/messages.js";
import { RunRenderer } from "../../ui/run-renderer.js";
import { EXIT } from "../exit-codes.js";
import { finishRun } from "./run-result.js";

export interface ContinueCommandOptions {
  agent?: string;
  quiet?: boolean;
  verbose?: boolean;
  unsafe?: boolean;
  auto?: boolean;
}

/**
 * The manual counterpart of the automatic relay (docs/FAILOVER.md §5): the command for
 * the morning after a nightly limit. Same agent via its own resume when that is
 * possible, otherwise the next agent in the chain with the handoff preamble.
 */
export async function continueCommand(options: ContinueCommandOptions = {}): Promise<void> {
  const renderer = new RunRenderer({
    ...(options.quiet !== undefined ? { quiet: options.quiet } : {}),
    ...(options.verbose !== undefined ? { verbose: options.verbose } : {}),
  });
  const cwd = process.cwd();
  const store = await SessionStore.load(cwd);
  const task = store.session.task;
  const last = store.lastTurn();

  if (task.trim() === "" || last === undefined) {
    renderer.fail(messages.nothingToContinue, 'baton run "your task"');
    process.exitCode = EXIT.usage;
    return;
  }

  const { config, warnings } = await loadConfig(cwd, {
    ...(options.auto === true ? { permissionLevel: "auto" as const } : {}),
  });
  const usage = await UsageStore.load();

  renderer.task(task);
  for (const warning of warnings) renderer.warn(warning);

  const detected = new Map<AgentId, DetectResult>();
  for (const result of await detectAll()) detected.set(result.id, result);
  const ready = (agent: AgentId): boolean => detected.get(agent)?.verdict === "ready";
  const cooling = (agent: AgentId): boolean =>
    usage.cooldown(agent, config.cooldownMinutes, new Date()).cooling;

  // Prefer the agent that was working on this, resuming its own session when it left one.
  let startAgent: AgentId | undefined;
  let resumeRef: string | undefined;
  if (ready(last.agent) && !cooling(last.agent)) {
    startAgent = last.agent;
    const adapter = getAdapter(last.agent);
    if (last.sessionRef !== undefined && adapter.buildResumeArgs !== undefined) {
      resumeRef = last.sessionRef;
    }
  } else {
    for (const candidate of config.chain) {
      if (candidate === last.agent || !ready(candidate) || cooling(candidate)) continue;
      startAgent = candidate;
      break;
    }
  }

  if (startAgent === undefined) {
    renderer.fail(messages.noAgentAvailable, "baton status");
    process.exitCode = EXIT.exhausted;
    return;
  }

  const isRelay = startAgent !== last.agent || resumeRef === undefined;
  const handoff = await refreshHandoff(cwd, store, { maxRelays: config.maxRelays });
  renderer.routerNote(
    resumeRef !== undefined
      ? messages.continueResume(startAgent)
      : messages.continueRelay(startAgent, handoff.rootPath),
  );


  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  process.once("SIGINT", onSigint);
  try {
    const outcome = await executeTask(task, cwd, renderer, {
      signal: controller.signal,
      agent: startAgent,
      ...(options.auto !== undefined ? { auto: options.auto } : {}),
      ...(options.unsafe !== undefined ? { unsafe: options.unsafe } : {}),
      ...(options.verbose !== undefined ? { verbose: options.verbose } : {}),
      start: {
        prompt: messages.continuePrompt,
        ...(resumeRef !== undefined ? { sessionRef: resumeRef } : {}),
        relay: isRelay,
      },
    });
    if (outcome.kind === "blocked") {
      renderer.fail(outcome.reason, outcome.remedy);
      process.exitCode = outcome.usage ? EXIT.usage : EXIT.exhausted;
      return;
    }
    finishRun(renderer, outcome.result, outcome.startAgent);
  } finally {
    process.removeListener("SIGINT", onSigint);
    renderer.stop();
  }
}
