import path from "node:path";
import { batonHome, readJsonFile } from "./paths.js";
import type { AgentId } from "./types.js";

export type FailureKind = "limit" | "auth" | "not_installed" | "crash" | "unknown";

export interface Classification {
  kind: FailureKind;
  raw: string;
  /** Best-effort human string, e.g. "resets 19:00" or "try again in 3 hours". */
  resetHint?: string;
  /** Machine-readable reset time (unix seconds) when the provider gave one. */
  resetsAt?: number;
}

/**
 * Layer B pattern tables (docs/FAILOVER.md §1).
 *
 * Every pattern here is backed by a line in `fixtures/<agent>/limit.txt`, and a test
 * asserts both directions: each pattern matches its fixture, and NO pattern matches any
 * healthy `ok-*` fixture. Patterns run over failure output only — never over the text of
 * a run that is going fine — which is what keeps broad tokens like `429` safe.
 */
export const DEFAULT_LIMIT_PATTERNS: Record<AgentId, string[]> = {
  claude: [
    "usage limit reached",
    "rate limit",
    "limit reached\\b.*resets?",
    "You've reached your",
    "5-hour limit",
    "weekly limit",
  ],
  codex: [
    "usage limit",
    "rate limit",
    "\\b429\\b",
    "You've hit",
    "too many requests",
    "exceeded your quota",
  ],
  gemini: [
    "RESOURCE_EXHAUSTED",
    "quota exceeded",
    "\\b429\\b",
    "rate limit",
    "Quota exceeded for quota metric",
  ],
};

export type PatternTable = Record<AgentId, RegExp[]>;

function compile(patterns: Record<AgentId, string[]>): PatternTable {
  const table = {} as PatternTable;
  for (const agent of Object.keys(patterns) as AgentId[]) {
    table[agent] = (patterns[agent] ?? [])
      .map((pattern) => {
        try {
          return new RegExp(pattern, "i");
        } catch {
          // why: a user-supplied pattern must never crash a run — skip it instead.
          return undefined;
        }
      })
      .filter((pattern): pattern is RegExp => pattern !== undefined);
  }
  return table;
}

export const defaultPatternTable = (): PatternTable => compile(DEFAULT_LIMIT_PATTERNS);

export interface UserPatternsResult {
  table: PatternTable;
  /** Set when the user's patterns.json was unusable — warn once, keep going. */
  warning?: string;
}

/**
 * `~/.baton/patterns.json` EXTENDS the defaults, never replaces them, so a user can
 * patch new provider wording the same day it appears without waiting for a release.
 */
export async function loadPatternTable(home: string = batonHome()): Promise<UserPatternsResult> {
  const table = defaultPatternTable();
  const file = path.join(home, "patterns.json");
  const parsed = await readJsonFile<Record<string, unknown>>(file);
  if (parsed === undefined) return { table };

  const extra: Record<AgentId, string[]> = { claude: [], codex: [], gemini: [] };
  let malformed = false;
  for (const agent of Object.keys(extra) as AgentId[]) {
    const value = parsed[agent];
    if (value === undefined) continue;
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      extra[agent] = value as string[];
    } else {
      malformed = true;
    }
  }
  const extraTable = compile(extra);
  for (const agent of Object.keys(table) as AgentId[]) {
    table[agent] = [...(table[agent] ?? []), ...(extraTable[agent] ?? [])];
  }
  return malformed
    ? { table, warning: `${file}: expected string arrays per agent — using the defaults` }
    : { table };
}

const RESET_PATTERNS: RegExp[] = [
  /\bresets?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*\([^)]+\))?)/i,
  /\btry again (?:in|after)\s+([^.,\n]{2,40})/i,
  /\bretry in\s+([^.,\n]{2,40})/i,
  /\bwait\s+([0-9]+\s*(?:seconds?|minutes?|hours?))/i,
];

/** Best-effort only — docs/FAILOVER.md deliberately does not ask for strict parsing. */
export function extractResetHint(text: string): string | undefined {
  for (const pattern of RESET_PATTERNS) {
    const match = pattern.exec(text);
    const captured = match?.[1]?.trim();
    if (captured !== undefined && captured !== "") {
      return pattern.source.startsWith("\\bresets")
        ? `resets ${captured}`
        : `try again in ${captured}`;
    }
  }
  return undefined;
}

const AUTH_PATTERNS: RegExp[] = [
  /\bnot (?:logged|signed) in\b/i,
  /\bplease (?:log|sign) ?in\b/i,
  /\bauthentication (?:required|failed|error)\b/i,
  /\bunauthorized\b/i,
  /\b401\b/,
  /\bcredentials? (?:not found|missing|expired|invalid)\b/i,
  /\blogin (?:required|expired)\b/i,
  /\bsession (?:expired|invalid)\b/i,
  /\binvalid api key\b/i,
];

export interface ClassifyOptions {
  table?: PatternTable;
  /** Structured signal already extracted by an adapter (Layer A wins). */
  structured?: { kind: "limit"; resetHint?: string; resetsAt?: number };
}

/**
 * Classify failure output. Layer A (structured) beats Layer B (patterns), and anything
 * unrecognised stays `crash`/`unknown` — never `limit`. A wrong relay burns a second
 * provider's quota on a broken workspace; a wrong stop costs one manual command
 * (failover-detection skill).
 */
export function classifyFailureOutput(
  agent: AgentId,
  text: string,
  options: ClassifyOptions = {},
): Classification {
  const raw = text.trim();
  if (options.structured !== undefined) {
    return {
      kind: "limit",
      raw,
      ...(options.structured.resetHint !== undefined
        ? { resetHint: options.structured.resetHint }
        : extractResetHint(raw) !== undefined
          ? { resetHint: extractResetHint(raw) as string }
          : {}),
      ...(options.structured.resetsAt !== undefined
        ? { resetsAt: options.structured.resetsAt }
        : {}),
    };
  }

  if (AUTH_PATTERNS.some((pattern) => pattern.test(raw))) {
    return { kind: "auth", raw };
  }

  const table = options.table ?? defaultPatternTable();
  if ((table[agent] ?? []).some((pattern) => pattern.test(raw))) {
    const hint = extractResetHint(raw);
    return { kind: "limit", raw, ...(hint !== undefined ? { resetHint: hint } : {}) };
  }

  return { kind: "crash", raw };
}

/** Claude carries an exact reset time; adapters embed it in `raw` as `resetsAt=<epoch>`. */
export function extractResetsAt(text: string): number | undefined {
  const match = /\bresetsAt=(\d{9,12})\b/.exec(text);
  const value = match?.[1];
  return value === undefined ? undefined : Number(value);
}

let primedTable: PatternTable | undefined;

/**
 * Load `~/.baton/patterns.json` once per process so adapters can classify synchronously
 * mid-stream. Until primed (and if the file is missing) the shipped defaults apply.
 */
export async function primePatterns(home: string = batonHome()): Promise<string | undefined> {
  const { table, warning } = await loadPatternTable(home);
  primedTable = table;
  return warning;
}

export function activePatternTable(): PatternTable {
  return primedTable ?? defaultPatternTable();
}

/** Tests only: forget anything primed by an earlier test. */
export function resetPrimedPatterns(): void {
  primedTable = undefined;
}
