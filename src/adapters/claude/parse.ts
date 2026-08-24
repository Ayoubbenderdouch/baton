import type { AgentEvent } from "../../core/types.js";

/**
 * Claude Code stream-json parsing.
 *
 * Shapes verified against 2.1.241 captures in fixtures/claude/ — every branch below
 * exists because a real line looked like that, never because a doc said so.
 */

interface ClaudeContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
}

interface ClaudeLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  message?: { content?: ClaudeContentBlock[] };
  rate_limit_info?: {
    status?: string;
    resetsAt?: number;
    rateLimitType?: string;
  };
  is_error?: boolean;
  result?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * `rate_limit_event.status` is "allowed" on a healthy run. These are the words that
 * mean "you are cut off"; anything unrecognised is deliberately NOT treated as a limit
 * (a wrong relay burns a second provider's quota — failover-detection skill).
 */
const BLOCKED_STATUS = /reject|exhaust|block|denied|limit_reached|throttl|over_limit/i;
const ALLOWED_STATUS = /^(allowed|ok|active|warning|allowed_warning)$/i;

export function isBlockedRateLimitStatus(status: string | undefined): boolean {
  if (status === undefined) return false;
  if (ALLOWED_STATUS.test(status)) return false;
  return BLOCKED_STATUS.test(status);
}

/** Unix seconds -> "resets 19:00". Best-effort, no strict parsing (docs/FAILOVER.md). */
export function formatResetHint(
  epochSeconds: number | undefined,
  timeZone?: string,
): string | undefined {
  if (epochSeconds === undefined || !Number.isFinite(epochSeconds)) return undefined;
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  const formatted = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
  return `resets ${formatted}`;
}

function toolDetail(block: ClaudeContentBlock): string | undefined {
  const input = block.input;
  if (input === undefined) return undefined;
  for (const key of ["command", "description", "file_path", "pattern", "path", "url"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

/**
 * Map one stream-json line to zero or more AgentEvents.
 * Unknown line types are ignored on purpose: Claude Code adds event types over time
 * (hook_started, rate_limit_event, …) and an unknown line must never break a run.
 */
export function parseClaudeLine(line: string): AgentEvent[] {
  const trimmed = line.trim();
  if (trimmed === "") return [];
  let parsed: ClaudeLine;
  try {
    parsed = JSON.parse(trimmed) as ClaudeLine;
  } catch {
    return [];
  }

  switch (parsed.type) {
    case "system": {
      if (parsed.subtype === "init") {
        return [{ type: "start", ...(parsed.session_id ? { sessionRef: parsed.session_id } : {}) }];
      }
      return [];
    }

    case "assistant": {
      const events: AgentEvent[] = [];
      for (const block of parsed.message?.content ?? []) {
        if (block.type === "text" && typeof block.text === "string" && block.text !== "") {
          events.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use" && typeof block.name === "string") {
          const detail = toolDetail(block);
          events.push({ type: "tool", name: block.name, ...(detail ? { detail } : {}) });
        }
      }
      return events;
    }

    case "rate_limit_event": {
      const info = parsed.rate_limit_info;
      if (!isBlockedRateLimitStatus(info?.status)) return [];
      const hint = formatResetHint(info?.resetsAt);
      return [
        {
          type: "limit",
          raw: `rate_limit_event: ${info?.status ?? "unknown"} (${info?.rateLimitType ?? "unknown window"})`,
          ...(hint ? { resetHint: hint } : {}),
        },
      ];
    }

    case "result":
      return parseClaudeResult(parsed);

    default:
      return [];
  }
}

/** The final envelope, shared by `--output-format json` and the last stream-json line. */
export function parseClaudeResult(parsed: ClaudeLine): AgentEvent[] {
  const events: AgentEvent[] = [];
  const usage = parsed.usage;
  if (usage && (usage.input_tokens !== undefined || usage.output_tokens !== undefined)) {
    events.push({
      type: "usage",
      ...(usage.input_tokens !== undefined ? { inputTokens: usage.input_tokens } : {}),
      ...(usage.output_tokens !== undefined ? { outputTokens: usage.output_tokens } : {}),
    });
  }
  events.push({
    type: "done",
    ok: parsed.is_error !== true,
    resultText: typeof parsed.result === "string" ? parsed.result : "",
    ...(parsed.session_id ? { sessionRef: parsed.session_id } : {}),
  });
  return events;
}

/** `--output-format json`: one envelope, same mapping as the final stream line. */
export function parseClaudeFinalJson(text: string): AgentEvent[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  try {
    return parseClaudeResult(JSON.parse(trimmed) as ClaudeLine);
  } catch {
    return [];
  }
}
