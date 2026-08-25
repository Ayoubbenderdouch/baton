import type { BatonConfig } from "./config.js";
import type { SessionStore } from "./session-store.js";
import type { AgentId, DetectResult } from "./types.js";
import type { UsageStore } from "./usage-store.js";

export type ContinuePlan =
  | { ok: false; reason: "no-task" | "no-agent" }
  | {
      ok: true;
      task: string;
      startAgent: AgentId;
      /** Provider-native session to resume; absent means hand over the briefing. */
      resumeRef?: string;
      isRelay: boolean;
      previousAgent: AgentId;
    };

/**
 * Who should pick the task back up, and how (docs/FAILOVER.md §5).
 *
 * Pure decision logic, shared by `baton continue` and the shell's `/continue`, so the
 * two can never answer differently.
 */
export function planContinue(options: {
  store: SessionStore;
  config: BatonConfig;
  usage: UsageStore;
  detected: Map<AgentId, DetectResult>;
  canResume: (agent: AgentId) => boolean;
  now: Date;
}): ContinuePlan {
  const task = options.store.session.task;
  const last = options.store.lastTurn();
  if (task.trim() === "" || last === undefined) return { ok: false, reason: "no-task" };

  const ready = (agent: AgentId): boolean =>
    options.detected.get(agent)?.verdict === "ready" &&
    !options.usage.cooldown(agent, options.config.cooldownMinutes, options.now).cooling;

  if (ready(last.agent)) {
    const resumeRef =
      last.sessionRef !== undefined && options.canResume(last.agent) ? last.sessionRef : undefined;
    return {
      ok: true,
      task,
      startAgent: last.agent,
      isRelay: resumeRef === undefined,
      previousAgent: last.agent,
      ...(resumeRef !== undefined ? { resumeRef } : {}),
    };
  }

  for (const candidate of options.config.chain) {
    if (candidate === last.agent || !ready(candidate)) continue;
    return {
      ok: true,
      task,
      startAgent: candidate,
      isRelay: true,
      previousAgent: last.agent,
    };
  }
  return { ok: false, reason: "no-agent" };
}
