import type { ProviderSpec } from "../shared.js";

/** Codex CLI — verified against codex-cli 0.147.0 (docs/CLI-VERIFICATION.md). */
export const codexSpec: ProviderSpec = {
  id: "codex",
  displayName: "Codex CLI",
  binName: "codex",
  versionArgs: ["--version"],
  installCommand: "npm i -g @openai/codex",
  loginCommand: "codex login",
  probeArgs: ["exec", "--json", "--sandbox", "read-only", "reply with the word ok"],
  authCommands: {
    login: ["login"],
    logout: ["logout"],
  },
  modelFlag: "--model",
};
