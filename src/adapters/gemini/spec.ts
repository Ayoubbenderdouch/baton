import type { ProviderSpec } from "../shared.js";

/** Gemini CLI — verified against 0.56.0 (docs/CLI-VERIFICATION.md). */
export const geminiSpec: ProviderSpec = {
  id: "gemini",
  displayName: "Gemini CLI",
  binName: "gemini",
  versionArgs: ["--version"],
  installCommand: "npm i -g @google/gemini-cli",
  loginCommand: "gemini   (then pick your account)",
  probeArgs: ["-p", "reply with the word ok", "-o", "json"],
};
