import type { BatonConfig } from "./config.js";
import { isAgentId, type AgentId } from "./types.js";

export interface RouteInput {
  task: string;
  /** `--agent` — always obeyed, even while cooling down (docs/ROUTING.md). */
  agentFlag?: string;
  /** `--role architect` */
  role?: string;
  /** Extra context length the caller already knows about (files piped in, etc.). */
  attachedContextChars?: number;
}

export interface RouteDecision {
  agent: AgentId | undefined;
  /** One short line for the UI: why this agent. */
  reason: string;
  /** Agents that matched earlier but were filtered out, with the reason. */
  skipped: { agent: AgentId; reason: string }[];
}

export interface Availability {
  (agent: AgentId): { ok: boolean; reason: string };
}

/**
 * Deterministic heuristics only — no LLM classification in v1. A user must be able to
 * answer "why did it pick codex?" from docs/ROUTING.md alone.
 *
 * Resolution order: explicit flag → role → rules → first available agent of the chain.
 */
export function routeTask(
  input: RouteInput,
  config: BatonConfig,
  isAvailable: Availability,
): RouteDecision {
  const skipped: { agent: AgentId; reason: string }[] = [];

  if (input.agentFlag !== undefined && input.agentFlag !== "") {
    if (!isAgentId(input.agentFlag)) {
      return { agent: undefined, reason: `unknown agent "${input.agentFlag}"`, skipped };
    }
    // Obeyed even when cooling down — the user asked for it explicitly.
    return { agent: input.agentFlag, reason: "--agent", skipped };
  }

  const consider = (agent: AgentId, reason: string): RouteDecision | undefined => {
    const availability = isAvailable(agent);
    if (availability.ok) return { agent, reason, skipped };
    // One line per unavailable agent, however many rules pointed at it.
    if (!skipped.some((entry) => entry.agent === agent)) {
      skipped.push({ agent, reason: availability.reason });
    }
    return undefined;
  };

  if (input.role !== undefined && input.role !== "") {
    const mapped = config.roles[input.role];
    if (mapped === undefined) {
      return {
        agent: undefined,
        reason: `unknown role "${input.role}" — known roles: ${Object.keys(config.roles).join(", ")}`,
        skipped,
      };
    }
    const decision = consider(mapped, `role "${input.role}"`);
    if (decision !== undefined) return decision;
  }

  const haystack = input.task.toLowerCase();
  for (const rule of config.rules) {
    const { keywordsAny, promptCharsOver, attachedContextCharsOver } = rule.match;
    let reason: string | undefined;

    if (keywordsAny !== undefined) {
      // Plain lowercase substring matching — no NLP, so any language works.
      const hit = keywordsAny.find((keyword) => haystack.includes(keyword.toLowerCase()));
      if (hit !== undefined) reason = `keyword "${hit}"`;
    }
    if (reason === undefined && promptCharsOver !== undefined && input.task.length > promptCharsOver) {
      reason = `prompt over ${promptCharsOver} chars`;
    }
    if (
      reason === undefined &&
      attachedContextCharsOver !== undefined &&
      (input.attachedContextChars ?? 0) > attachedContextCharsOver
    ) {
      reason = `attached context over ${attachedContextCharsOver} chars`;
    }
    if (reason === undefined) continue;

    const decision = consider(rule.agent, reason);
    if (decision !== undefined) return decision;
  }

  for (const agent of config.chain) {
    const decision = consider(agent, "chain head");
    if (decision !== undefined) return decision;
  }

  return { agent: undefined, reason: "no agent available", skipped };
}
