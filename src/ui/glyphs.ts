/**
 * Structural glyphs, with an ASCII profile for terminals that cannot draw them.
 *
 * Rule from docs/CROSS-PLATFORM.md: alignment must never depend on emoji width. The
 * glyphs below are all single-cell box/geometric characters; emoji appear only as
 * accents at the start of a line, where a double-width surprise costs nothing.
 */
export interface GlyphSet {
  /** Header bar and status bar. */
  bar: string;
  barLight: string;
  caret: string;
  /** Tool activity bullet. */
  bullet: string;
  /** Nested tool result. */
  nested: string;
  dotReady: string;
  dotCooling: string;
  dotBlocked: string;
  done: string;
  limit: string;
  relay: string;
  arrow: string;
  /** Separator between facts on one line. */
  sep: string;
  fail: string;
  ellipsis: string;
  border: "round" | "classic";
}

export const UNICODE_GLYPHS: GlyphSet = {
  bar: "▌",
  barLight: "▐",
  caret: "❯",
  bullet: "⏺",
  nested: "⎿",
  dotReady: "●",
  dotCooling: "◌",
  dotBlocked: "✗",
  done: "◆",
  limit: "⚡",
  relay: "⇥",
  arrow: "→",
  sep: "·",
  fail: "✗",
  ellipsis: "…",
  border: "round",
};

export const ASCII_GLYPHS: GlyphSet = {
  bar: "|",
  barLight: "|",
  caret: ">",
  bullet: "*",
  nested: "L",
  dotReady: "*",
  dotCooling: "o",
  dotBlocked: "x",
  done: "*",
  limit: "!",
  relay: "->",
  arrow: "->",
  sep: "-",
  fail: "x",
  ellipsis: "...",
  border: "classic",
};

/**
 * Legacy Windows console (conhost) draws none of this reliably; Windows Terminal sets
 * WT_SESSION and does. `TERM=dumb` means a terminal that should get plain text.
 */
export function preferAscii(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.BATON_ASCII === "1") return true;
  if (env.TERM === "dumb") return true;
  if (process.platform === "win32") {
    return env.WT_SESSION === undefined && env.TERM_PROGRAM === undefined;
  }
  return false;
}

let active: GlyphSet | undefined;

export function glyphs(): GlyphSet {
  active ??= preferAscii() ? ASCII_GLYPHS : UNICODE_GLYPHS;
  return active;
}

/** `--ascii` and tests. */
export function setGlyphProfile(profile: "unicode" | "ascii" | "auto"): void {
  active = profile === "auto" ? undefined : profile === "ascii" ? ASCII_GLYPHS : UNICODE_GLYPHS;
  if (profile === "auto") glyphs();
}

/**
 * Typographic characters that read fine on a modern terminal but come out as `?` on a
 * legacy console with a non-UTF-8 codepage. Applied at the two output boundaries when
 * the ASCII profile is active, so prose stays readable everywhere else.
 */
const TRANSLITERATE: [RegExp, string][] = [
  [/[\u2014\u2013]/g, "-"],
  [/\u2026/g, "..."],
  [/[\u2192\u21e5]/g, "->"],
  [/\u00b7/g, "-"],
  [/[\u201c\u201d]/g, '"'],
  [/[\u2018\u2019]/g, "'"],
];

export function asciify(text: string): string {
  if (glyphs().border !== "classic") return text;
  let out = text;
  for (const [pattern, replacement] of TRANSLITERATE) out = out.replace(pattern, replacement);
  return out;
}
