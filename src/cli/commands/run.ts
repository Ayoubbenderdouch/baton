import { detectAll, getAdapter } from "../../adapters/registry.js";
import { runTask, type TaskConfig } from "../../core/failover.js";
import { primePatterns } from "../../core/limit-detector.js";
import { SessionStore } from "../../core/session-store.js";
import { DEFAULT_COOLDOWN_MINUTES, UsageStore } from "../../core/usage-store.js";
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
  const usage = await UsageStore.load();
  const store = await SessionStore.load(cwd);

  renderer.task(task);
  if (patternWarning !== undefined) renderer.warn(patternWarning);
  if (store.recovered) renderer.warn(messages.sessionRecovered);

  // Detection is cached for the whole task: the relay asks about availability again.
  const detected = new Map<AgentId, DetectResult>();
  for (const result of await detectAll()) detected.set(result.id, result);
  const detect = async (id: AgentId): Promise<DetectResult> =>
    detected.get(id) ?? getAdapter(id).detect();

  // The router lands in M6; today it is the explicit flag, else the first available
  // agent of the chain.
  let startAgent: AgentId | undefined;
  let reason = "chain head";
  if (isAgentId(options.agent ?? "")) {
    startAgent = options.agent as AgentId;
    reason = "--agent";
  } else {
    for (const candidate of chain) {
      const result = detected.get(candidate);
      if (result?.verdict !== "ready") continue;
      const cooling = usage.cooldown(candidate, DEFAULT_COOLDOWN_MINUTES, new Date());
      if (cooling.cooling) {
        renderer.note(messages.coolingDown(candidate, cooling.resetHint));
        continue;
      }
      startAgent = candidate;
      break;
    }
  }

  if (startAgent === undefined) {
    renderer.fail(messages.noAgentAvailable, "baton doctor");
    process.exitCode = EXIT.exhausted;
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

  renderer.routerNote(messages.routerDecision(startAgent, reason));
  if (options.unsafe === true) renderer.warn(messages.unsafeWarning(startAgent));

  const permissionLevel: PermissionLevel = options.auto === true ? "auto" : "safe";
  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  process.once("SIGINT", onSigint);

  const config: TaskConfig = {
    chain,
    maxRelays: DEFAULT_MAX_RELAYS,
    cooldownMinutes: DEFAULT_COOLDOWN_MINUTES,
    permissionLevel,
    ...(options.unsafe !== undefined ? { unsafe: options.unsafe } : {}),
    ...(options.relayOnError !== undefined ? { relayOnError: options.relayOnError } : {}),
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
    }, config);

    const last = result.outcomes.at(-1);
    switch (result.status) {
      case "done":
        renderer.agentDone(
          last?.agent ?? startAgent,
          last?.durationMs ?? 0,
          last?.filesChanged.length ?? 0,
        );
        process.exitCode = EXIT.ok;
        break;
      case "cancel":
        renderer.stop();
        renderer.warn(messages.cancelled);
        process.exitCode = EXIT.cancelled;
        break;
      case "exhausted":
        renderer.fail(messages.allAgentsExhausted, "baton status");
        for (const blocked of result.blocked) {
          renderer.note(messages.blockedAgent(blocked.agent, blocked.reason, blocked.until));
        }
        process.exitCode = EXIT.exhausted;
        break;
      case "error":
        renderer.fail(
          messages.agentFailed(last?.agent ?? startAgent, last?.error?.kind ?? "unknown"),
          last?.error?.kind === "auth" ? `${last?.agent}` : undefined,
        );
        if (last?.error?.raw) renderer.note(last.error.raw.split("\n")[0] ?? "");
        process.exitCode = EXIT.error;
        break;
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    renderer.stop();
  }
}

export { AGENT_IDS };
