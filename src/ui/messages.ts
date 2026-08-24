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

  unexpectedError: (logPath: string): string =>
    `baton hit an unexpected error -> details written to ${logPath}`,
} as const;
