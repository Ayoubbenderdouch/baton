import type { ProviderSpec } from "../shared.js";

/**
 * Claude Code — verified against 2.1.241 (docs/CLI-VERIFICATION.md).
 * Baton never passes model or auth flags: model choice is the provider's business
 * (and the user's, via `agents.claude.extraArgs`).
 */
export const claudeSpec: ProviderSpec = {
  id: "claude",
  displayName: "Claude Code",
  binName: "claude",
  versionArgs: ["--version"],
  installCommand: "npm i -g @anthropic-ai/claude-code",
  loginCommand: "claude auth login",
  probeArgs: ["-p", "reply with the word ok", "--output-format", "json"],
  authCommands: {
    login: ["auth", "login"],
    logout: ["auth", "logout"],
  },
  modelFlag: "--model",
};
