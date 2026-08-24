import path from "node:path";
import type { AgentId } from "./types.js";
import { backupCorrupt, projectBatonDir, readTextFile, writeFileAtomic } from "./paths.js";

export interface Turn {
  ts: string;
  agent: AgentId;
  promptPreview: string;
  resultSummary: string;
  filesChanged: string[];
  usage?: { inputTokens?: number; outputTokens?: number };
  sessionRef?: string;
  endedBy: "done" | "limit" | "error" | "cancel";
}

export interface SessionData {
  version: 1;
  task: string;
  createdAt: string;
  updatedAt: string;
  turns: Turn[];
  /** Rolling summary of what has actually been accomplished (compressed in M4). */
  summary: string;
  relayCount: number;
  /** Agents that already hit a limit for THIS task — never relay back to them. */
  limitedAgents: AgentId[];
}

export const PROMPT_PREVIEW_CHARS = 200;
export const RESULT_SUMMARY_CHARS = 500;

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function emptySession(task: string, now: string): SessionData {
  return {
    version: 1,
    task,
    createdAt: now,
    updatedAt: now,
    turns: [],
    summary: "",
    relayCount: 0,
    limitedAgents: [],
  };
}

/**
 * `.baton/session.json` — the source of truth for handoffs.
 * A corrupt or unreadable file never breaks a command: it is kept as `.bak` and the
 * session starts fresh (handoff-protocol skill).
 */
export class SessionStore {
  readonly file: string;
  private data: SessionData;
  readonly recovered: boolean;

  private constructor(file: string, data: SessionData, recovered: boolean) {
    this.file = file;
    this.data = data;
    this.recovered = recovered;
  }

  static async load(cwd: string, now: string = new Date().toISOString()): Promise<SessionStore> {
    const file = path.join(projectBatonDir(cwd), "session.json");
    const raw = await readTextFile(file);
    if (raw === undefined) return new SessionStore(file, emptySession("", now), false);
    try {
      const parsed = JSON.parse(raw) as SessionData;
      if (parsed.version !== 1 || !Array.isArray(parsed.turns)) throw new Error("shape");
      return new SessionStore(file, parsed, false);
    } catch {
      await backupCorrupt(file);
      return new SessionStore(file, emptySession("", now), true);
    }
  }

  get session(): SessionData {
    return this.data;
  }

  /** A new task resets relay bookkeeping but keeps the file's history intact. */
  startTask(task: string, now: string = new Date().toISOString()): void {
    if (this.data.task !== task) {
      this.data.task = task;
      this.data.relayCount = 0;
      this.data.limitedAgents = [];
      if (this.data.turns.length === 0) this.data.createdAt = now;
    }
    this.data.updatedAt = now;
  }

  appendTurn(turn: Turn): void {
    this.data.turns.push({
      ...turn,
      promptPreview: truncate(turn.promptPreview, PROMPT_PREVIEW_CHARS),
      resultSummary: truncate(turn.resultSummary, RESULT_SUMMARY_CHARS),
    });
    this.data.updatedAt = turn.ts;
    if (turn.endedBy === "limit" && !this.data.limitedAgents.includes(turn.agent)) {
      this.data.limitedAgents.push(turn.agent);
    }
  }

  setSummary(summary: string): void {
    this.data.summary = summary;
  }

  countRelay(): void {
    this.data.relayCount += 1;
  }

  lastTurn(): Turn | undefined {
    return this.data.turns.at(-1);
  }

  async save(): Promise<void> {
    await writeFileAtomic(this.file, `${JSON.stringify(this.data, null, 2)}\n`);
  }
}
