import { detectAll, getAdapter } from "../adapters/registry.js";
import { loadConfig, type BatonConfig } from "./config.js";
import { runTask, type TaskConfig, type TaskResult, type TaskStart } from "./failover.js";
import { primePatterns } from "./limit-detector.js";
import { forcedAgentWarning, routeTask } from "./router.js";
import { SessionStore } from "./session-store.js";
import { isAgentId, type AgentId, type DetectResult } from "./types.js";
import { UsageStore } from "./usage-store.js";
import { messages } from "../ui/messages.js";
import type { TaskRenderer } from "../ui/task-renderer.js";

export interface ExecuteOptions {
  agent?: string;
  role?: string;
  chain?: AgentId[];
  auto?: boolean;
  unsafe?: boolean;
  relayOnError?: boolean;
  verbose?: boolean;
  signal?: AbortSignal;
  /** `baton continue` overrides the first turn. */
  start?: TaskStart;
}

export type ExecuteOutcome =
  | { kind: "ran"; result: TaskResult; startAgent: AgentId }
  | { kind: "blocked"; reason: string; remedy?: string; usage: boolean };

/**
 * One code path from a task string to a finished (or relayed) run: config, detection,
 * routing, then the failover engine. `baton run`, `baton continue` and the interactive
 * shell all go through here, so they cannot drift apart.
 */
export async function executeTask(
  task: string,
  cwd: string,
  renderer: TaskRenderer,
  options: ExecuteOptions = {},
): Promise<ExecuteOutcome> {
  const patternWarning = await primePatterns();
  const flagOverrides: Partial<BatonConfig> = {
    ...(options.chain !== undefined ? { chain: options.chain } : {}),
    ...(options.auto === true ? { permissionLevel: "auto" as const } : {}),
    ...(options.relayOnError === true ? { relayOnError: true } : {}),
  };
  const { config, warnings } = await loadConfig(cwd, flagOverrides);
  const usage = await UsageStore.load();
  const store = await SessionStore.load(cwd);

  for (const warning of warnings) renderer.warn(warning);
  if (patternWarning !== undefined) renderer.warn(patternWarning);
  if (store.recovered) renderer.warn(messages.sessionRecovered);

  const detected = new Map<AgentId, DetectResult>();
  for (const result of await detectAll()) detected.set(result.id, result);
  const detect = async (id: AgentId): Promise<DetectResult> =>
    detected.get(id) ?? getAdapter(id).detect();

  const isAvailable = (agent: AgentId): { ok: boolean; reason: string } => {
    const result = detected.get(agent);
    if (result === undefined) return { ok: false, reason: "unknown agent" };
    if (result.verdict === "not_installed") return { ok: false, reason: "not installed" };
    if (result.verdict === "auth") return { ok: false, reason: "not signed in" };
    if (result.verdict === "error") return { ok: false, reason: result.detail ?? "unavailable" };
    const cooling = usage.cooldown(agent, config.cooldownMinutes, new Date());
    if (cooling.cooling) {
      return {
        ok: false,
        reason: `cooling down${cooling.resetHint ? ` (${cooling.resetHint})` : ""}`,
      };
    }
    return { ok: true, reason: "ready" };
  };

  const decision = routeTask(
    {
      task,
      ...(options.agent !== undefined ? { agentFlag: options.agent } : {}),
      ...(options.role !== undefined ? { role: options.role } : {}),
    },
    config,
    isAvailable,
  );
  for (const skipped of decision.skipped) {
    renderer.note(messages.skippedAgent(skipped.agent, skipped.reason));
  }

  const startAgent = decision.agent;
  const forcedWarning = forcedAgentWarning(decision, isAvailable);
  if (forcedWarning !== undefined && startAgent !== undefined) {
    renderer.warn(messages.forcedAgentAnyway(startAgent, forcedWarning));
  }

  if (startAgent === undefined) {
    const remedy = decision.reason.startsWith("unknown role")
      ? "baton config get roles"
      : decision.reason.startsWith("unknown agent")
        ? "baton agents"
        : "baton doctor";
    return {
      kind: "blocked",
      reason: decision.reason,
      remedy,
      usage: decision.reason.startsWith("unknown"),
    };
  }

  const startDetected = detected.get(startAgent);
  if (startDetected !== undefined && startDetected.verdict !== "ready") {
    return {
      kind: "blocked",
      reason:
        startDetected.verdict === "not_installed"
          ? messages.agentNotInstalled(startAgent, startDetected.remedy ?? "")
          : `${startAgent}: ${startDetected.detail ?? startDetected.verdict}`,
      ...(startDetected.remedy !== undefined ? { remedy: startDetected.remedy } : {}),
      usage: false,
    };
  }

  renderer.routerNote(messages.routerDecision(startAgent, decision.reason));
  if (options.unsafe === true) renderer.warn(messages.unsafeWarning(startAgent));

  const taskConfig: TaskConfig = {
    chain: config.chain,
    maxRelays: config.maxRelays,
    cooldownMinutes: config.cooldownMinutes,
    permissionLevel: config.permissionLevel,
    relayOnError: config.relayOnError,
    timeoutMs: config.runTimeoutMs,
    extraArgs: Object.fromEntries(
      Object.entries(config.agents).map(([agent, value]) => [agent, value?.extraArgs ?? []]),
    ),
    ...(options.unsafe !== undefined ? { unsafe: options.unsafe } : {}),
    ...(options.verbose !== undefined ? { verbose: options.verbose } : {}),
  };

  const result = await runTask(
    task,
    startAgent,
    {
      cwd,
      renderer,
      store,
      usage,
      getAdapter,
      detect,
      now: () => new Date(),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    },
    taskConfig,
    options.start ?? {},
  );

  return { kind: "ran", result, startAgent };
}

export { isAgentId };
