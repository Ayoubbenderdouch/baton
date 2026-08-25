import path from "node:path";
import { claudeSpec } from "../adapters/claude/spec.js";
import { codexSpec } from "../adapters/codex/spec.js";
import { geminiSpec } from "../adapters/gemini/spec.js";
import { detectAll, getAdapter } from "../adapters/registry.js";
import type { ProviderSpec } from "../adapters/shared.js";
import {
  DEFAULT_CONFIG,
  loadConfig,
  projectConfigPath,
  readRawConfig,
  setByPath,
  setByPathValue,
  writeConfigFile,
} from "../core/config.js";
import { refreshHandoff } from "../core/handoff-refresh.js";
import { SessionStore } from "../core/session-store.js";
import { buildStatusReport } from "../core/status.js";
import { AGENT_IDS, isAgentId, type AgentId, type DetectResult } from "../core/types.js";
import { UsageStore } from "../core/usage-store.js";
import { messages } from "./messages.js";
import { renderAgents, renderDoctor, renderStatus } from "./render.js";
import { table } from "./format.js";
import { paint } from "./theme.js";

/**
 * The slash-command registry: one source of truth for the palette, `/help`, the docs
 * table and the tests. A command exists here or it does not exist at all.
 *
 * Handlers never reimplement anything — they call the same core functions the CLI
 * subcommands call, so `/status` and `baton status` cannot disagree.
 */
export interface CommandContext {
  cwd: string;
  /** Append lines to the transcript. */
  print: (lines: string[]) => void;
  /** Re-run detection and refresh the chips. */
  refresh: (probeAuth?: boolean) => Promise<DetectResult[]>;
  detected: () => DetectResult[];
  setOverride: (agent: AgentId | undefined) => void;
  setRole: (role: string | undefined) => void;
  clearTranscript: () => void;
  quit: () => void;
  /** Ask the user to choose an agent inline; undefined means they cancelled. */
  pickAgent: (options: { prompt: string; disabled?: AgentId[] }) => Promise<AgentId | undefined>;
  /** Ask for a line of text inline; undefined means cancelled. */
  askText: (prompt: string) => Promise<string | undefined>;
  /** Leave the TUI, run a child with inherited stdio, come back. */
  suspend: (bin: string, args: string[], note?: string) => Promise<number>;
  /** Run a task through the normal pipeline (used by /continue). */
  runTask: (task: string, options?: { agent?: AgentId; resumeRef?: string; relay?: boolean }) => Promise<void>;
}

export interface CommandDef {
  id: string;
  aliases?: string[];
  args?: string;
  description: string;
  handler: (args: string[], context: CommandContext) => Promise<void> | void;
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

async function resolveAgentArg(
  args: string[],
  context: CommandContext,
  prompt: string,
  disabled?: AgentId[],
): Promise<AgentId | undefined> {
  const given = args[0];
  if (given !== undefined) {
    if (isAgentId(given)) return given;
    context.print([paint.error(messages.unknownAgent(given))]);
    return undefined;
  }
  return context.pickAgent({ prompt, ...(disabled !== undefined ? { disabled } : {}) });
}

async function writeProjectValue(cwd: string, dotPath: string, value: string): Promise<string | undefined> {
  const file = projectConfigPath(cwd);
  const raw = await readRawConfig(file);
  const result = setByPath(raw, dotPath, value);
  if (!result.ok) return result.error;
  await writeConfigFile(file, raw);
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* the registry                                                                */
/* -------------------------------------------------------------------------- */

export const COMMANDS: CommandDef[] = [
  {
    id: "help",
    aliases: ["?"],
    description: "list the commands",
    handler: (_args, context) => {
      const rows = COMMANDS.map((command) => [
        paint.accent(`/${command.id}${command.args ? ` ${command.args}` : ""}`),
        paint.dim(command.description),
      ]);
      context.print([paint.bold(messages.commandsTitle), ...table(["", ""], rows)]);
    },
  },
  {
    id: "agents",
    description: "which agent CLIs are installed",
    handler: async (_args, context) => {
      context.print(renderAgents(await detectAll()).split("\n"));
    },
  },
  {
    id: "doctor",
    description: "check installs and sign-ins (costs one request per agent)",
    handler: async (_args, context) => {
      const results = await context.refresh(true);
      context.print(renderDoctor(results, { probed: true }).split("\n"));
    },
  },
  {
    id: "status",
    description: "usage and cooldowns across every agent",
    handler: async (_args, context) => {
      const usage = await UsageStore.load();
      const { config } = await loadConfig(context.cwd);
      const report = buildStatusReport(usage, {
        project: context.cwd,
        now: new Date(),
        cooldownMinutes: config.cooldownMinutes,
      });
      context.print(renderStatus(report, { deep: false }).split("\n"));
    },
  },
  {
    id: "login",
    args: "[agent]",
    description: "sign in to a provider (opens its official flow)",
    handler: async (args, context) => {
      const agent = await resolveAgentArg(args, context, messages.pickProvider);
      if (agent === undefined) return;
      await runAuthFlow(agent, "login", context);
    },
  },
  {
    id: "logout",
    args: "[agent]",
    description: "sign out of a provider",
    handler: async (args, context) => {
      const agent = await resolveAgentArg(args, context, messages.pickProvider);
      if (agent === undefined) return;
      await runAuthFlow(agent, "logout", context);
    },
  },
  {
    id: "model",
    args: "[agent] [name|clear]",
    description: "show or set the model passed through to a provider",
    handler: async (args, context) => {
      const agent = await resolveAgentArg(args, context, messages.pickProvider);
      if (agent === undefined) return;
      const spec = SPECS[agent];
      const { config } = await loadConfig(context.cwd);
      const current = (config.agents[agent]?.extraArgs ?? []).join(" ");

      const rest = args.slice(isAgentId(args[0] ?? "") ? 1 : 0).join(" ").trim();
      if (rest === "") {
        context.print([
          current === "" ? messages.modelNone(agent) : messages.modelNow(agent, current),
        ]);
        const answer = await context.askText(messages.modelPrompt(agent));
        if (answer === undefined || answer.trim() === "") return;
        await applyModel(agent, answer.trim(), spec.modelFlag, context);
        return;
      }
      await applyModel(agent, rest, spec.modelFlag, context);
    },
  },
  {
    id: "agent",
    args: "<id|auto>",
    description: "lock the next run to one agent, or hand it back to the router",
    handler: (args, context) => {
      const value = args[0];
      if (value === undefined) {
        context.print([paint.dim(messages.agentUsage)]);
        return;
      }
      if (value === "auto") {
        context.setOverride(undefined);
        context.print([messages.overrideCleared]);
        return;
      }
      if (!isAgentId(value)) {
        context.print([paint.error(messages.unknownAgent(value))]);
        return;
      }
      context.setOverride(value);
      context.print([messages.agentOverride(value)]);
    },
  },
  {
    id: "chain",
    args: "<a,b[,c]>",
    description: "set the failover order for this project",
    handler: async (args, context) => {
      const value = args.join(" ").trim();
      if (value === "") {
        context.print([paint.dim(messages.chainUsage)]);
        return;
      }
      const error = await writeProjectValue(context.cwd, "chain", value);
      if (error !== undefined) {
        context.print([paint.error(error)]);
        return;
      }
      const { config } = await loadConfig(context.cwd);
      context.print([messages.chainSet(config.chain.join(", "))]);
    },
  },
  {
    id: "role",
    args: "<name>",
    description: "route the next run by role",
    handler: async (args, context) => {
      const role = args[0];
      if (role === undefined) {
        context.print([paint.dim(messages.roleUsage)]);
        return;
      }
      const { config } = await loadConfig(context.cwd);
      const mapped = config.roles[role];
      if (mapped === undefined) {
        context.print([paint.error(messages.roleUnknown(role, Object.keys(config.roles).join(", ")))]);
        return;
      }
      context.setRole(role);
      context.print([messages.roleSet(role, mapped)]);
    },
  },
  {
    id: "permissions",
    args: "[safe|auto]",
    description: "show or set what agents may do to your files",
    handler: async (args, context) => {
      const value = args[0];
      const { config } = await loadConfig(context.cwd);
      if (value === undefined) {
        context.print([messages.permissionsNow(config.permissionLevel)]);
        return;
      }
      if (value === "unsafe") {
        context.print([paint.warn(messages.permissionsUnsafe)]);
        return;
      }
      if (value !== "safe" && value !== "auto") {
        context.print([paint.dim(messages.permissionsUsage)]);
        return;
      }
      const error = await writeProjectValue(context.cwd, "permissionLevel", value);
      context.print([error !== undefined ? paint.error(error) : messages.permissionsSet(value)]);
    },
  },
  {
    id: "handoff",
    description: "write HANDOFF.md right now",
    handler: async (_args, context) => {
      const store = await SessionStore.load(context.cwd);
      const { config } = await loadConfig(context.cwd);
      const paths = await refreshHandoff(context.cwd, store, { maxRelays: config.maxRelays });
      context.print([messages.handoffWritten(path.relative(context.cwd, paths.rootPath) || paths.rootPath)]);
    },
  },
  {
    id: "continue",
    description: "pick the last task back up",
    handler: async (_args, context) => {
      const { planContinue } = await import("../core/continue-plan.js");
      const store = await SessionStore.load(context.cwd);
      const { config } = await loadConfig(context.cwd);
      const usage = await UsageStore.load();
      const detected = new Map(context.detected().map((result) => [result.id, result]));
      const plan = planContinue({
        store,
        config,
        usage,
        detected,
        canResume: (agent) => getAdapter(agent).buildResumeArgs !== undefined,
        now: new Date(),
      });
      if (!plan.ok) {
        context.print([
          paint.error(plan.reason === "no-task" ? messages.nothingToContinue : messages.noAgentAvailable),
        ]);
        return;
      }
      await context.runTask(plan.task, {
        agent: plan.startAgent,
        relay: plan.isRelay,
        ...(plan.resumeRef !== undefined ? { resumeRef: plan.resumeRef } : {}),
      });
    },
  },
  {
    id: "config",
    description: "show the effective config and where each value came from",
    handler: async (_args, context) => {
      const { config, origins } = await loadConfig(context.cwd);
      const rows = Object.keys(config).map((key) => {
        const value = JSON.stringify((config as Record<string, unknown>)[key]);
        return [
          paint.accent(key),
          value !== undefined && value.length > 46 ? `${value.slice(0, 45)}…` : (value ?? ""),
          paint.dim(`(${origins[key] ?? "default"})`),
        ];
      });
      context.print(table(["KEY", "VALUE", "FROM"], rows));
    },
  },
  {
    id: "init",
    description: "create .baton/ with a project config",
    handler: async (_args, context) => {
      const file = projectConfigPath(context.cwd);
      await writeConfigFile(file, {
        chain: DEFAULT_CONFIG.chain,
        permissionLevel: DEFAULT_CONFIG.permissionLevel,
      });
      context.print([messages.initDone(path.relative(context.cwd, file) || file)]);
    },
  },
  {
    id: "clear",
    description: "clear the transcript on screen",
    handler: (_args, context) => {
      context.clearTranscript();
      context.print([paint.dim(messages.transcriptCleared)]);
    },
  },
  {
    id: "quit",
    aliases: ["exit"],
    description: "leave baton",
    handler: (_args, context) => context.quit(),
  },
];

const SPECS: Record<AgentId, ProviderSpec> = {
  claude: claudeSpec,
  codex: codexSpec,
  gemini: geminiSpec,
};

async function applyModel(
  agent: AgentId,
  value: string,
  flag: string,
  context: CommandContext,
): Promise<void> {
  if (value === "clear") {
    const file = projectConfigPath(context.cwd);
    const raw = await readRawConfig(file);
    const agents = (raw.agents ?? {}) as Record<string, unknown>;
    delete agents[agent];
    raw.agents = agents;
    await writeConfigFile(file, raw);
    context.print([messages.modelCleared(agent)]);
    return;
  }
  // Two argv elements, never one string with a space: that is how a CLI reads a flag.
  const file = projectConfigPath(context.cwd);
  const raw = await readRawConfig(file);
  const result = setByPathValue(raw, `agents.${agent}.extraArgs`, [flag, value]);
  if (!result.ok) {
    context.print([paint.error(result.error)]);
    return;
  }
  await writeConfigFile(file, raw);
  context.print([paint.dim(messages.modelSet(agent, value, flag))]);
}

/**
 * Hand the terminal to the provider's own auth flow, then take it back.
 * Baton spawns and waits — it never reads, stores or forwards a credential.
 */
async function runAuthFlow(
  agent: AgentId,
  kind: "login" | "logout",
  context: CommandContext,
): Promise<void> {
  const spec = SPECS[agent];
  const args = spec.authCommands[kind];
  const interactive = spec.authCommands.interactive === true;

  if (args === undefined && !(kind === "login" && interactive)) {
    context.print([paint.warn(messages.noAuthCommand(agent))]);
    return;
  }

  const note = interactive ? messages.authInteractiveNote(spec.displayName) : undefined;
  const code = await context.suspend(spec.binName, args ?? [], note);
  const results = await context.refresh(false);
  const detected = results.find((result) => result.id === agent);

  if (code === 0 && detected?.verdict !== "not_installed") {
    context.print([
      paint.success(kind === "login" ? messages.signedInNow(agent) : messages.signedOutNow(agent)),
    ]);
    return;
  }
  context.print([
    paint.error(messages.authFailed(agent, `${kind} exited with code ${code}`)),
    paint.accent(`→ ${spec.binName} ${(args ?? []).join(" ")}`.trim()),
  ]);
}

/* -------------------------------------------------------------------------- */
/* lookup + filtering                                                          */
/* -------------------------------------------------------------------------- */

export function findCommand(name: string): CommandDef | undefined {
  const needle = name.toLowerCase();
  return COMMANDS.find(
    (command) => command.id === needle || (command.aliases ?? []).includes(needle),
  );
}

/** `/login codex` -> { name: "login", args: ["codex"] } */
export function parseCommandLine(input: string): { name: string; args: string[] } {
  // Leading whitespace is normal when someone pastes; strip it before the slash.
  const trimmed = input.trimStart();
  const body = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  const parts = body.split(/\s+/).filter((part) => part !== "");
  return { name: (parts[0] ?? "").toLowerCase(), args: parts.slice(1) };
}

function fuzzyScore(candidate: string, query: string): number | undefined {
  let index = 0;
  let score = 0;
  for (const char of query) {
    const found = candidate.indexOf(char, index);
    if (found === -1) return undefined;
    score += found - index;
    index = found + 1;
  }
  return score;
}

/**
 * Prefix matches first (they are what someone typing means), then fuzzy matches.
 * Aliases match too, so `/exit` finds `/quit`.
 */
export function filterCommands(input: string): CommandDef[] {
  const { name } = parseCommandLine(input);
  if (name === "") return COMMANDS;

  const prefix: CommandDef[] = [];
  const fuzzy: { command: CommandDef; score: number }[] = [];

  for (const command of COMMANDS) {
    const names = [command.id, ...(command.aliases ?? [])];
    if (names.some((candidate) => candidate.startsWith(name))) {
      prefix.push(command);
      continue;
    }
    const scores = names
      .map((candidate) => fuzzyScore(candidate, name))
      .filter((score): score is number => score !== undefined);
    if (scores.length > 0) fuzzy.push({ command, score: Math.min(...scores) });
  }

  fuzzy.sort((a, b) => a.score - b.score);
  return [...prefix, ...fuzzy.map((entry) => entry.command)];
}

/** Agent ids offered as second-level completion for `[agent]` commands. */
export function agentCompletions(command: CommandDef | undefined): readonly AgentId[] {
  return command?.args?.includes("agent") === true ? AGENT_IDS : [];
}
