import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentId } from "./types.js";

export interface DeepTotals {
  agent: AgentId;
  inputTokens: number;
  outputTokens: number;
  /** How many records contributed — 0 means "found nothing usable". */
  entries: number;
  /** The directory that was read, so `baton status --deep` can name it out loud. */
  root: string;
  /** How many files were opened — the user sees the size of what was touched. */
  filesRead: number;
}

/**
 * Optional, read-only, best-effort reading of the providers' own local history
 * (docs/USAGE-TRACKING.md, `--deep`).
 *
 * These are undocumented internals that can change any day, so every field access is
 * guarded and an unknown shape is skipped in silence — `baton status` must never crash
 * because a provider changed a log format. Baton reads token counts and timestamps
 * only; it never touches credentials, and it never writes into these directories.
 */
const MAX_FILES = 400;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Files this reader must never open, whatever their extension. The transcripts it wants
 * are token counts; anything whose name suggests a secret is skipped before it is read,
 * so a provider moving a credential into these trees cannot make Baton read it.
 */
const NEVER_READ = /(credential|auth|token|secret|cookie|session[_-]?key|\.key$|\.pem$)/i;

export function isForbiddenHistoryFile(fileName: string): boolean {
  return NEVER_READ.test(fileName);
}

export function claudeHistoryRoot(): string {
  return process.env.BATON_CLAUDE_HOME ?? path.join(os.homedir(), ".claude", "projects");
}

export function codexHistoryRoot(): string {
  return process.env.BATON_CODEX_HOME ?? path.join(os.homedir(), ".codex", "sessions");
}

async function collectJsonlFiles(root: string, budget = MAX_FILES): Promise<string[]> {
  const found: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0 && found.length < budget) {
    const dir = queue.shift() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (
        entry.isFile() &&
        entry.name.endsWith(".jsonl") &&
        !isForbiddenHistoryFile(entry.name)
      ) {
        found.push(full);
      }
      if (found.length >= budget) break;
    }
  }
  return found;
}

/** Pull token counts out of whatever shape the record happens to have. */
function extractTokens(value: unknown): { input: number; output: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const usage = (record.usage ?? (record.message as Record<string, unknown> | undefined)?.usage) as
    | Record<string, unknown>
    | undefined;
  if (usage === undefined) return undefined;
  const input = usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens;
  if (typeof input !== "number" && typeof output !== "number") return undefined;
  return {
    input: typeof input === "number" ? input : 0,
    output: typeof output === "number" ? output : 0,
  };
}

function timestampOf(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const raw = record.timestamp ?? record.ts ?? record.created_at;
  if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
  if (typeof raw !== "string") return undefined;
  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

async function readTotals(root: string, agent: AgentId, since?: Date): Promise<DeepTotals> {
  const totals: DeepTotals = {
    agent,
    inputTokens: 0,
    outputTokens: 0,
    entries: 0,
    root,
    filesRead: 0,
  };
  const files = await collectJsonlFiles(root);
  const sinceMs = since?.getTime();

  for (const file of files) {
    try {
      const info = await stat(file);
      if (info.size > MAX_FILE_BYTES) continue;
      const content = await readFile(file, { encoding: "utf8" });
      totals.filesRead += 1;
      for (const line of content.split(/\r?\n/)) {
        if (line.trim() === "") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (sinceMs !== undefined) {
          const ts = timestampOf(parsed);
          if (ts !== undefined && ts < sinceMs) continue;
        }
        const tokens = extractTokens(parsed);
        if (tokens === undefined) continue;
        totals.inputTokens += tokens.input;
        totals.outputTokens += tokens.output;
        totals.entries += 1;
      }
    } catch {
      // why: an unreadable or vanished file is normal here — skip it.
    }
  }
  return totals;
}

export async function readClaudeLocalHistory(
  root: string = claudeHistoryRoot(),
  since?: Date,
): Promise<DeepTotals> {
  return readTotals(root, "claude", since);
}

export async function readCodexLocalHistory(
  root: string = codexHistoryRoot(),
  since?: Date,
): Promise<DeepTotals> {
  return readTotals(root, "codex", since);
}
