import { detectAll, getAdapter } from "../../adapters/registry.js";
import { loadConfig, type BatonConfig } from "../../core/config.js";
import { runTask, type TaskConfig } from "../../core/failover.js";
import { forcedAgentWarning, routeTask } from "../../core/router.js";
import { primePatterns } from "../../core/limit-detector.js";
import { SessionStore } from "../../core/session-store.js";
import { UsageStore } from "../../core/usage-store.js";
import {
  AGENT_IDS,
  isAgentId,
  type AgentId,
  type DetectResult,
  type PermissionLevel,
} from "../../core/types.js";
import { messages } from "../../ui/messages.js";
import { RunRenderer } from "../../ui/run-renderer.js";
import { EXIT } from "../exit-codes.js";
import { finishRun } from "./run-result.js";

export const DEFAULT_CHAIN: AgentId[] = ["claude", "codex", "gemini"];
export const DEFAULT_MAX_RELAYS = 2;

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

function parseChain(value: string | undefined): { chain: AgentId[]; invalid?: string } {
  if (value === undefined) return { chain: DEFAULT_CHAIN };
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const invalid = parts.find((part) => !isAgentId(part));
  if (invalid !== undefined) return { chain: DEFAULT_CHAIN, invalid };
  return { chain: parts.length > 0 ? (parts as AgentId[]) : DEFAULT_CHAIN };
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
  const { chain, invalid } = parseChain(options.chain);
  if (invalid !== undefined) {
    renderer.fail(messages.unknownAgent(invalid), "baton agents");
    process.exitCode = EXIT.usage;
    return;
  }

  const patternWarning = await primePatterns();
  const cwd = process.cwd();
  const flagOverrides: Partial<BatonConfig> = {
    ...(options.chain !== undefined ? { chain } : {}),
    ...(options.auto === true ? { permissionLevel: "auto" as const } : {}),
    ...(options.relayOnError === true ? { relayOnError: true } : {}),
  };
  const { config, warnings } = await loadConfig(cwd, flagOverrides);
  const usage = await UsageStore.load();
  const store = await SessionStore.load(cwd);

  renderer.task(task);
  for (const warning of warnings) renderer.warn(warning);
  if (patternWarning !== undefined) renderer.warn(patternWarning);
  if (store.recovered) renderer.warn(messages.sessionRecovered);

  // Detection is cached for the whole task; the relay re-checks cooldowns as it goes.
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
      return { ok: false, reason: `cooling down${cooling.resetHint ? ` (${cooling.resetHint})` : ""}` };
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
  // An explicit --agent is obeyed even while cooling down, but never silently.
  const forcedWarning = forcedAgentWarning(decision, isAvailable);
  if (forcedWarning !== undefined && startAgent !== undefined) {
    renderer.warn(messages.forcedAgentAnyway(startAgent, forcedWarning));
  }

  if (startAgent === undefined) {
    // Point at the thing that actually fixes this failure, not at doctor for everything.
    const remedy = decision.reason.startsWith("unknown role")
      ? "baton config get roles"
      : decision.reason.startsWith("unknown agent")
        ? "baton agents"
        : "baton doctor";
    renderer.fail(decision.reason, remedy);
    process.exitCode = decision.reason.startsWith("unknown") ? EXIT.usage : EXIT.exhausted;
    return;
  }

  const startDetected = detected.get(startAgent);
  if (startDetected !== undefined && startDetected.verdict !== "ready") {
    renderer.fail(
      startDetected.verdict === "not_installed"
        ? messages.agentNotInstalled(startAgent, startDetected.remedy ?? "")
        : `${startAgent}: ${startDetected.detail ?? startDetected.verdict}`,
      startDetected.remedy,
    );
    process.exitCode = EXIT.error;
    return;
  }

  const reason = decision.reason;
  renderer.routerNote(messages.routerDecision(startAgent, reason));
  if (options.unsafe === true) renderer.warn(messages.unsafeWarning(startAgent));

  const permissionLevel: PermissionLevel = config.permissionLevel;
  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  process.once("SIGINT", onSigint);

  const taskConfig: TaskConfig = {
    chain: config.chain,
    maxRelays: config.maxRelays,
    cooldownMinutes: config.cooldownMinutes,
    permissionLevel,
    relayOnError: config.relayOnError,
    timeoutMs: config.runTimeoutMs,
    extraArgs: Object.fromEntries(
      Object.entries(config.agents).map(([agent, value]) => [agent, value?.extraArgs ?? []]),
    ),
    ...(options.unsafe !== undefined ? { unsafe: options.unsafe } : {}),
    ...(options.verbose !== undefined ? { verbose: options.verbose } : {}),
  };

  try {
    const result = await runTask(task, startAgent, {
      cwd,
      renderer,
      store,
      usage,
      getAdapter,
      detect,
      now: () => new Date(),
      signal: controller.signal,
    }, taskConfig);

    finishRun(renderer, result, startAgent);
  } finally {
    process.removeListener("SIGINT", onSigint);
    renderer.stop();
  }
}

export { AGENT_IDS };
