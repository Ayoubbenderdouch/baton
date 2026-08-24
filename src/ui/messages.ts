/**
 * Every user-facing string lives here (baton-ui-style skill).
 * Short, active voice, numbers over adjectives, no exclamation-mark spam.
 */
export const messages = {
  tagline: "Pass the baton, keep the context.",

  disclaimer:
    "Baton is an independent open-source project, not affiliated with or endorsed by " +
    "Anthropic, OpenAI, or Google. It orchestrates the official CLIs you installed and " +
    "authenticated yourself.",

  notImplemented: (command: string): string =>
    `baton ${command}: not implemented yet (scaffold build).`,

  doctorTitle: "BATON DOCTOR",
  agentsTitle: "BATON AGENTS",
  detecting: "detecting agent CLIs",

  authNotProbedNote:
    "auth column says `not probed` because verifying a login costs one request — " +
    "run `baton doctor --probe` when you want that checked.",

  doctorSummary: (ready: string[], total: number): string => {
    if (ready.length === 0) {
      return `0/${total} ready — install at least one agent CLI, then run baton doctor again.`;
    }
    if (ready.length === 1) {
      return `1/${total} ready — baton will run everything on ${ready[0]} (no relay target yet).`;
    }
    const list = `${ready.slice(0, -1).join(", ")} and ${ready[ready.length - 1]}`;
    return `${ready.length}/${total} ready — baton can relay between ${list}.`;
  },

  remedyInstall: (agent: string, command: string): string =>
    `${agent}: not installed -> run: ${command}`,
  remedySignIn: (agent: string, command: string): string =>
    `${agent}: not signed in -> run: ${command}   (then retry baton run)`,
  remedyError: (agent: string, detail: string): string => `${agent}: ${detail}`,

  stillWorking: (minutes: number): string =>
    `still working — no output for ${minutes} min`,

  turnSummary: (durationMs: number, filesChanged: number): string => {
    const seconds = Math.round(durationMs / 1000);
    const time = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const files = filesChanged === 1 ? "1 file changed" : `${filesChanged} files changed`;
    return `done in ${time} · ${files}`;
  },

  logHint: (logPath: string): string => `full detail: ${logPath}`,

  routerDecision: (agent: string, reason: string): string => `router → ${agent} (${reason})`,

  noAgentAvailable:
    "no agent is available — run `baton doctor` to see what is installed and signed in",

  agentNotInstalled: (agent: string, command: string): string =>
    `${agent} is not installed -> run: ${command}`,

  cancelled: "cancelled — the agent process and its children were stopped",

  emptyTask: "no task given",

  unknownAgent: (agent: string): string =>
    `unknown agent "${agent}" — pick one of claude, codex, gemini`,

  unsafeWarning: (agent: string): string =>
    `--unsafe: ${agent} runs with its own permission bypass. It can change anything in this folder.`,

  sessionRecovered:
    ".baton/session.json was unreadable — kept it as session.json.bak and started fresh",

  limitNoRelayYet: (agent: string, resetHint?: string): string =>
    `${agent} hit its usage limit${resetHint ? ` (${resetHint})` : ""}`,

  agentFailed: (agent: string, kind: string): string => `${agent} stopped: ${kind}`,

  skippedAgent: (agent: string, reason: string): string => `${agent} skipped: ${reason}`,

  coolingDown: (agent: string, resetHint?: string): string =>
    `${agent} is cooling down${resetHint ? ` (${resetHint})` : ""} — trying the next agent`,

  allAgentsExhausted:
    "every agent in the chain is out of reach right now — nothing was lost, HANDOFF.md is written",

  blockedAgent: (agent: string, reason: string, until?: Date): string => {
    const when =
      until === undefined
        ? ""
        : ` until ${until.toISOString().slice(11, 16)} UTC`;
    return `${agent}: ${reason}${when}`;
  },

  handoffWritten: (file: string): string => `handoff written: ${file} (mirrored to .baton/)`,

  statusTitle: "BATON STATUS",
  statusNoData: "no data yet — run something with baton run",
  statusTokensNote: "tokens = runs launched via baton only; Baton never asks a provider about your quota",
  statusDeepHint: "baton status --deep also reads the providers' own local history (read-only)",
  statusResetConfirm: "clear ~/.baton/usage.json? [y/N] ",
  statusResetDone: "usage history cleared",
  statusResetKept: "kept — nothing was deleted",

  configTitle: "BATON CONFIG (effective)",
  configGetNeedsKey: "baton config get <key>   e.g. baton config get roles.architect",
  configSetNeedsKeyValue: "baton config set <key> <value>   e.g. baton config set chain codex,claude",
  configUnknownKey: (key: string): string => `no config value at "${key}"`,
  configUnknownAction: (action: string): string =>
    `unknown action "${action}" — use: baton config [get|set]`,

  initTitle: "BATON INIT",
  initWritten: (file: string): string => `wrote ${file}`,
  initNext: (agents: string): string =>
    `  run \`baton doctor\` to check ${agents}, then \`baton run "your task"\``,

  handoffEmpty:
    "  nothing has run yet — the briefing has the task and the project's verify commands only",

  unexpectedError: (logPath: string): string =>
    `baton hit an unexpected error -> details written to ${logPath}`,
} as const;
