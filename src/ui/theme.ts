import pc from "picocolors";

/**
 * Baton's palette (docs/UX-SPEC.md): violet primary, cyan accent.
 * Never an orange/coral primary — that is Claude Code's territory.
 */
const has256 =
  pc.isColorSupported &&
  (process.env.COLORTERM === "truecolor" ||
    process.env.COLORTERM === "24bit" ||
    (process.env.TERM ?? "").includes("256"));

/** Violet #8B5CF6 -> 256-color 135, degrading to magenta, then to plain text. */
export const violet = (s: string): string => {
  if (has256) return `\x1b[38;5;135m${s}\x1b[39m`;
  return pc.isColorSupported ? pc.magenta(s) : s;
};

export const theme = {
  violet,
  accent: pc.cyan,
  success: pc.green,
  warn: pc.yellow,
  error: pc.red,
  dim: pc.dim,
  bold: pc.bold,
  plain: (s: string): string => s,
};

/** Per-agent badge colors — used ONLY to tag output attribution. */
export const agentColor: Record<string, (s: string) => string> = {
  claude: violet,
  codex: pc.cyan,
  gemini: pc.green,
};

/** `[claude]` — lowercase, bracketed, subtle. */
export function badge(agentId: string): string {
  const paint = agentColor[agentId] ?? theme.plain;
  return paint(`[${agentId}]`);
}

export const isTTY = (): boolean => Boolean(process.stdout.isTTY);
