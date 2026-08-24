import type { AgentId } from "./types.js";
import { AGENT_IDS } from "./types.js";
import type { UsageStore } from "./usage-store.js";

export interface AgentStatus {
  agent: AgentId;
  runsToday: number;
  inputTokensToday: number;
  outputTokensToday: number;
  /** True when Baton has never launched this agent. */
  noData: boolean;
  lastLimitTs?: string;
  lastLimitResetHint?: string;
  cooling: boolean;
  coolingUntil?: string;
  deep?: { inputTokens: number; outputTokens: number; entries: number };
}

export interface StatusReport {
  project: string;
  generatedAt: string;
  agents: AgentStatus[];
}

function startOfLocalDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** Everything `baton status` shows, computed from the ledger Baton itself wrote. */
export function buildStatusReport(
  usage: UsageStore,
  options: { project: string; now: Date; cooldownMinutes: number },
): StatusReport {
  const dayStart = startOfLocalDay(options.now);
  const agents: AgentStatus[] = AGENT_IDS.map((agent) => {
    const events = usage.usage.events.filter((event) => event.agent === agent);
    const today = events.filter((event) => {
      const time = new Date(event.ts).getTime();
      return !Number.isNaN(time) && time >= dayStart;
    });
    const cooldown = usage.cooldown(agent, options.cooldownMinutes, options.now);
    const lastLimit = usage.lastLimit(agent);
    return {
      agent,
      runsToday: today.length,
      inputTokensToday: today.reduce((sum, event) => sum + (event.inputTokens ?? 0), 0),
      outputTokensToday: today.reduce((sum, event) => sum + (event.outputTokens ?? 0), 0),
      noData: events.length === 0,
      cooling: cooldown.cooling,
      ...(cooldown.until !== undefined ? { coolingUntil: cooldown.until.toISOString() } : {}),
      ...(lastLimit !== undefined ? { lastLimitTs: lastLimit.ts } : {}),
      ...(lastLimit?.resetHint !== undefined
        ? { lastLimitResetHint: lastLimit.resetHint }
        : {}),
    };
  });

  return {
    project: options.project,
    generatedAt: options.now.toISOString(),
    agents,
  };
}

/** 41000 -> "41k"; small numbers stay exact. */
export function formatTokens(count: number): string {
  if (count === 0) return "0";
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return thousands >= 100 ? `${Math.round(thousands)}k` : `${thousands.toFixed(1).replace(/\.0$/, "")}k`;
}
