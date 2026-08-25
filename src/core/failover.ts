import { RELAY_PREAMBLE } from "./handoff.js";
import { recordTurnInSummary, refreshHandoff } from "./handoff-refresh.js";
import { extractResetsAt } from "./limit-detector.js";
import { runTurn, type TurnOutcome } from "./orchestrator.js";
import type { SessionStore } from "./session-store.js";
import type { AgentAdapter, AgentId, DetectResult, PermissionLevel } from "./types.js";
import type { UsageStore } from "./usage-store.js";
import type { TaskRenderer } from "../ui/task-renderer.js";

export interface TaskConfig {
  chain: AgentId[];
  maxRelays: number;
  cooldownMinutes: number;
  permissionLevel: PermissionLevel;
  unsafe?: boolean;
  relayOnError?: boolean;
  timeoutMs?: number;
  verbose?: boolean;
  extraArgs?: Partial<Record<AgentId, string[]>>;
}

export interface TaskDeps {
  cwd: string;
  renderer: TaskRenderer;
  store: SessionStore;
  usage: UsageStore;
  getAdapter: (id: AgentId) => AgentAdapter;
  detect: (id: AgentId) => Promise<DetectResult>;
  now: () => Date;
  signal?: AbortSignal;
}

export type TaskStatus = "done" | "exhausted" | "error" | "cancel";

export interface TaskResult {
  status: TaskStatus;
  outcomes: TurnOutcome[];
  relays: number;
  /** Agents that were unavailable when the relay looked for a successor. */
  blocked: { agent: AgentId; reason: string; until?: Date }[];
}

export interface CandidateFilter {
  chain: AgentId[];
  current: AgentId;
  alreadyLimited: AgentId[];
  isAvailable: (agent: AgentId) => Promise<{ ok: boolean; reason: string; until?: Date }>;
}

/**
 * The next agent in the chain after the current one — wrapping around, so a chain head
 * that is free still gets used when the tail hits its limit. Skips agents that already
 * hit a limit for THIS task (loop protection), are cooling down, or are not installed.
 */
export async function pickNextAgent(
  filter: CandidateFilter,
): Promise<{ agent?: AgentId; blocked: { agent: AgentId; reason: string; until?: Date }[] }> {
  const index = filter.chain.indexOf(filter.current);
  const ordered =
    index === -1
      ? filter.chain
      : [...filter.chain.slice(index + 1), ...filter.chain.slice(0, index)];

  const blocked: { agent: AgentId; reason: string; until?: Date }[] = [];
  for (const candidate of ordered) {
    if (candidate === filter.current) continue;
    if (filter.alreadyLimited.includes(candidate)) {
      blocked.push({ agent: candidate, reason: "already hit its limit for this task" });
      continue;
    }
    const availability = await filter.isAvailable(candidate);
    if (availability.ok) return { agent: candidate, blocked };
    blocked.push({
      agent: candidate,
      reason: availability.reason,
      ...(availability.until !== undefined ? { until: availability.until } : {}),
    });
  }
  return { blocked };
}

/**
 * The relay (docs/FAILOVER.md §3): run the task, and when a provider hits its usage
 * limit, write the briefing and hand the same task to the next provider.
 */
export interface TaskStart {
  /** Prompt for the FIRST turn — defaults to the task itself. */
  prompt?: string;
  /** Provider-native session to resume for the first turn (`baton continue`). */
  sessionRef?: string;
  /** Treat the first turn as a relay (prepends the handoff preamble). */
  relay?: boolean;
}

export async function runTask(
  task: string,
  startAgent: AgentId,
  deps: TaskDeps,
  config: TaskConfig,
  start: TaskStart = {},
): Promise<TaskResult> {
  const outcomes: TurnOutcome[] = [];
  // Own the task lifecycle here: the handoff written mid-relay must carry the task even
  // when a caller forgot to register it.
  deps.store.startTask(task, deps.now().toISOString());
  let current = startAgent;
  let relays = 0;
  let isRelay = start.relay === true;
  let firstTurn = true;
  let blocked: TaskResult["blocked"] = [];

  const availability = async (
    agent: AgentId,
  ): Promise<{ ok: boolean; reason: string; until?: Date }> => {
    const detected = await deps.detect(agent);
    if (detected.verdict === "not_installed") return { ok: false, reason: "not installed" };
    if (detected.verdict === "auth") return { ok: false, reason: "not signed in" };
    if (detected.verdict === "error") return { ok: false, reason: detected.detail ?? "unavailable" };
    const cooling = deps.usage.cooldown(agent, config.cooldownMinutes, deps.now());
    if (cooling.cooling) {
      return {
        ok: false,
        reason: cooling.resetHint ?? "cooling down",
        ...(cooling.until !== undefined ? { until: cooling.until } : {}),
      };
    }
    return { ok: true, reason: "ready" };
  };

  for (;;) {
    const adapter = deps.getAdapter(current);
    const basePrompt = firstTurn && start.prompt !== undefined ? start.prompt : task;
    const prompt = isRelay ? `${RELAY_PREAMBLE}\n\n${basePrompt}` : basePrompt;
    const sessionRef = firstTurn ? start.sessionRef : undefined;
    firstTurn = false;

    const outcome = await runTurn({
      adapter,
      prompt,
      cwd: deps.cwd,
      permissionLevel: config.permissionLevel,
      renderer: deps.renderer,
      ...(sessionRef !== undefined ? { sessionRef } : {}),
      ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
      ...(config.unsafe !== undefined ? { unsafe: config.unsafe } : {}),
      ...(config.verbose !== undefined ? { verbose: config.verbose } : {}),
      ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
      ...(config.extraArgs?.[current] !== undefined
        ? { extraArgs: config.extraArgs[current] as string[] }
        : {}),
    });
    outcomes.push(outcome);

    const ts = deps.now().toISOString();
    deps.store.appendTurn({
      ts,
      agent: outcome.agent,
      promptPreview: task,
      resultSummary: outcome.resultText,
      filesChanged: outcome.filesChanged,
      endedBy: outcome.endedBy,
      ...(outcome.usage !== undefined ? { usage: outcome.usage } : {}),
      ...(outcome.sessionRef !== undefined ? { sessionRef: outcome.sessionRef } : {}),
    });
    if (outcome.resultText.trim() !== "") recordTurnInSummary(deps.store, outcome.resultText);
    deps.usage.recordTurn({
      ts,
      agent: outcome.agent,
      project: deps.cwd,
      endedBy: outcome.endedBy,
      ...(outcome.usage?.inputTokens !== undefined
        ? { inputTokens: outcome.usage.inputTokens }
        : {}),
      ...(outcome.usage?.outputTokens !== undefined
        ? { outputTokens: outcome.usage.outputTokens }
        : {}),
    });
    await deps.store.save();

    if (outcome.endedBy === "done") {
      await refreshHandoff(deps.cwd, deps.store, { maxRelays: config.maxRelays });
      await deps.usage.save(deps.now());
      return { status: "done", outcomes, relays, blocked };
    }
    if (outcome.endedBy === "cancel") {
      await deps.usage.save(deps.now());
      return { status: "cancel", outcomes, relays, blocked };
    }

    const isLimit = outcome.endedBy === "limit";
    if (isLimit) {
      const resetsAt = extractResetsAt(outcome.limit?.raw ?? "");
      deps.usage.recordLimit({
        ts,
        agent: outcome.agent,
        project: deps.cwd,
        ...(outcome.limit?.resetHint !== undefined ? { resetHint: outcome.limit.resetHint } : {}),
        ...(resetsAt !== undefined ? { resetsAt } : {}),
      });
    } else if (config.relayOnError !== true) {
      await deps.usage.save(deps.now());
      return { status: "error", outcomes, relays, blocked };
    }
    await deps.usage.save(deps.now());

    // The briefing is written BEFORE the next agent is spawned — always.
    const handoff = await refreshHandoff(deps.cwd, deps.store, { maxRelays: config.maxRelays });

    if (relays >= config.maxRelays) {
      deps.renderer.note(`relay limit reached (${config.maxRelays}) — stopping here`);
      return { status: "exhausted", outcomes, relays, blocked };
    }

    const next = await pickNextAgent({
      chain: config.chain,
      current,
      alreadyLimited: deps.store.session.limitedAgents,
      isAvailable: availability,
    });
    blocked = next.blocked;
    if (next.agent === undefined) {
      return { status: "exhausted", outcomes, relays, blocked };
    }

    deps.store.countRelay();
    await deps.store.save();
    relays += 1;
    deps.renderer.relay({
      from: current,
      to: next.agent,
      ...(outcome.limit?.resetHint !== undefined ? { resetHint: outcome.limit.resetHint } : {}),
      handoffPath: handoff.rootPath,
    });
    current = next.agent;
    isRelay = true;
  }
}
