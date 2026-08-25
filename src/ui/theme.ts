import pc from "picocolors";

/**
 * The single source of colour. Components import semantic tokens — never a literal.
 *
 * Identity rule (docs/UX-SPEC.md): violet primary, cyan accent, and **no orange or
 * coral anywhere**, which is Claude Code's territory. `theme.test.ts` computes the hue
 * of every token and fails if one drifts into the orange family, so the rule is code,
 * not a comment.
 */
export const palette = {
  /** Violet #8B5CF6 — the product's primary. */
  primary: "#8B5CF6",
  /** Cyan #22D3EE — accent, used for actionable things. */
  accent: "#22D3EE",
  success: "#4ADE80",
  /** Deliberately a clear yellow, well clear of the orange boundary. */
  warn: "#FDE047",
  error: "#F87171",
  muted: "#94A3B8",
} as const;

export type ColorToken = keyof typeof palette;

/** Per-agent colours, used ONLY to tag attribution. */
export const agentColors = {
  claude: palette.primary,
  codex: palette.accent,
  gemini: palette.success,
} as const;

export function agentColor(agent: string): string {
  return (agentColors as Record<string, string>)[agent] ?? palette.muted;
}

export const isTTY = (): boolean => Boolean(process.stdout.isTTY);

export const colorEnabled = (): boolean => pc.isColorSupported;

/* ------------------------------------------------------------------------ *
 * Plain-text painting, for the non-interactive renderer. Ink components use
 * the tokens above directly.
 * ------------------------------------------------------------------------ */

function ansiHex(hex: string, text: string): string {
  if (!pc.isColorSupported) return text;
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

export const paint = {
  primary: (text: string): string => ansiHex(palette.primary, text),
  accent: (text: string): string => ansiHex(palette.accent, text),
  success: (text: string): string => ansiHex(palette.success, text),
  warn: (text: string): string => ansiHex(palette.warn, text),
  error: (text: string): string => ansiHex(palette.error, text),
  dim: (text: string): string => pc.dim(text),
  bold: (text: string): string => pc.bold(text),
  agent: (agent: string, text: string): string => ansiHex(agentColor(agent), text),
  plain: (text: string): string => text,
};

/** `[claude]` — lowercase, bracketed, in that agent's colour. */
export function badge(agentId: string): string {
  return paint.agent(agentId, `[${agentId}]`);
}

/** Kept for callers that still speak in the old vocabulary. */
export const theme = {
  violet: paint.primary,
  accent: paint.accent,
  success: paint.success,
  warn: paint.warn,
  error: paint.error,
  dim: paint.dim,
  bold: paint.bold,
  plain: paint.plain,
};
