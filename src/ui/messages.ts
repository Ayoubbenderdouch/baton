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

  unexpectedError: (logPath: string): string =>
    `baton hit an unexpected error -> details written to ${logPath}`,
} as const;
