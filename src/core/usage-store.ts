import path from "node:path";
import { backupCorrupt, batonHome, readTextFile, writeFileAtomic } from "./paths.js";
import type { AgentId } from "./types.js";

/** Append-only event log — the schema docs/USAGE-TRACKING.md specifies. */
export interface UsageEvent {
  ts: string;
  agent: AgentId;
  project: string;
  inputTokens?: number;
  outputTokens?: number;
  endedBy: "done" | "limit" | "error" | "cancel";
}

export interface LimitRecord {
  ts: string;
  agent: AgentId;
  project: string;
  resetHint?: string;
  /** Unix seconds, when the provider gave an exact time. */
  resetsAt?: number;
}

export interface UsageData {
  version: 1;
  events: UsageEvent[];
  limits: LimitRecord[];
}

export const DEFAULT_COOLDOWN_MINUTES = 30;
const RETENTION_DAYS = 90;

export interface CooldownState {
  cooling: boolean;
  until?: Date;
  resetHint?: string;
}

function emptyData(): UsageData {
  return { version: 1, events: [], limits: [] };
}

/**
 * `~/.baton/usage.json`: what Baton itself launched, plus every limit it saw.
 * Baton never asks a provider's servers about quota — that would need credentials.
 */
export class UsageStore {
  readonly file: string;
  private data: UsageData;
  readonly recovered: boolean;

  private constructor(file: string, data: UsageData, recovered: boolean) {
    this.file = file;
    this.data = data;
    this.recovered = recovered;
  }

  static async load(home: string = batonHome()): Promise<UsageStore> {
    const file = path.join(home, "usage.json");
    const raw = await readTextFile(file);
    if (raw === undefined) return new UsageStore(file, emptyData(), false);
    try {
      const parsed = JSON.parse(raw) as UsageData;
      if (parsed.version !== 1 || !Array.isArray(parsed.events) || !Array.isArray(parsed.limits)) {
        throw new Error("shape");
      }
      return new UsageStore(file, parsed, false);
    } catch {
      await backupCorrupt(file);
      return new UsageStore(file, emptyData(), true);
    }
  }

  get usage(): UsageData {
    return this.data;
  }

  recordTurn(event: UsageEvent): void {
    this.data.events.push(event);
  }

  recordLimit(record: LimitRecord): void {
    this.data.limits.push(record);
  }

  lastLimit(agent: AgentId): LimitRecord | undefined {
    return [...this.data.limits].reverse().find((record) => record.agent === agent);
  }

  /**
   * An agent cools down for `cooldownMinutes` after a limit — or until the provider's
   * own reset time when that is later (docs/FAILOVER.md §2).
   */
  cooldown(agent: AgentId, cooldownMinutes: number, now: Date): CooldownState {
    const last = this.lastLimit(agent);
    if (last === undefined) return { cooling: false };
    const limitedAt = new Date(last.ts).getTime();
    if (Number.isNaN(limitedAt)) return { cooling: false };

    let untilMs = limitedAt + cooldownMinutes * 60_000;
    if (last.resetsAt !== undefined) {
      const resetMs = last.resetsAt * 1000;
      if (resetMs > untilMs) untilMs = resetMs;
    }
    const until = new Date(untilMs);
    return untilMs > now.getTime()
      ? {
          cooling: true,
          until,
          ...(last.resetHint !== undefined ? { resetHint: last.resetHint } : {}),
        }
      : { cooling: false };
  }

  /** Keep the file small and human-readable: 90 days, as specified. */
  prune(now: Date, retentionDays: number = RETENTION_DAYS): void {
    const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
    const keep = (ts: string): boolean => {
      const time = new Date(ts).getTime();
      return Number.isNaN(time) ? false : time >= cutoff;
    };
    this.data.events = this.data.events.filter((event) => keep(event.ts));
    this.data.limits = this.data.limits.filter((record) => keep(record.ts));
  }

  clear(): void {
    this.data = emptyData();
  }

  async save(now: Date = new Date()): Promise<void> {
    this.prune(now);
    await writeFileAtomic(this.file, `${JSON.stringify(this.data, null, 2)}\n`);
  }
}
