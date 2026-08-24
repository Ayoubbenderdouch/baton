import type { AgentEvent } from "../../core/types.js";

/**
 * Gemini CLI parsing for `-o stream-json` and `-o json`.
 * Shapes verified against gemini 0.56.0 — see fixtures/gemini/.
 */

interface GeminiStats {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  models?: Record<string, { tokens?: Record<string, number> }>;
}

interface GeminiLine {
  type?: string;
  role?: string;
  content?: string;
  tool_name?: string;
  parameters?: Record<string, unknown>;
  status?: string;
  message?: string;
  session_id?: string;
  error?: { message?: string; type?: string };
  stats?: GeminiStats;
  response?: string;
}

function usageFromStats(stats: GeminiStats | undefined): AgentEvent | undefined {
  if (stats === undefined) return undefined;
  if (stats.input_tokens !== undefined || stats.output_tokens !== undefined) {
    return {
      type: "usage",
      ...(stats.input_tokens !== undefined ? { inputTokens: stats.input_tokens } : {}),
      ...(stats.output_tokens !== undefined ? { outputTokens: stats.output_tokens } : {}),
    };
  }
  // `-o json` reports per model: tokens.prompt (in) and tokens.candidates (out).
  const models = stats.models;
  if (models === undefined) return undefined;
  let input = 0;
  let output = 0;
  let seen = false;
  for (const model of Object.values(models)) {
    const tokens = model.tokens;
    if (tokens === undefined) continue;
    if (typeof tokens.prompt === "number") {
      input += tokens.prompt;
      seen = true;
    }
    if (typeof tokens.candidates === "number") {
      output += tokens.candidates;
      seen = true;
    }
  }
  return seen ? { type: "usage", inputTokens: input, outputTokens: output } : undefined;
}

function toolDetail(parameters: Record<string, unknown> | undefined): string | undefined {
  if (parameters === undefined) return undefined;
  for (const key of ["command", "description", "file_path", "path", "pattern", "query"]) {
    const value = parameters[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

export function parseGeminiLine(line: string): AgentEvent[] {
  const trimmed = line.trim();
  if (trimmed === "") return [];
  let parsed: GeminiLine;
  try {
    parsed = JSON.parse(trimmed) as GeminiLine;
  } catch {
    return [];
  }

  switch (parsed.type) {
    case "init":
      return [{ type: "start", ...(parsed.session_id ? { sessionRef: parsed.session_id } : {}) }];

    case "message":
      if (parsed.role !== "assistant") return [];
      return typeof parsed.content === "string" && parsed.content !== ""
        ? [{ type: "text", text: parsed.content }]
        : [];

    case "tool_use": {
      const detail = toolDetail(parsed.parameters);
      return [
        { type: "tool", name: parsed.tool_name ?? "tool", ...(detail ? { detail } : {}) },
      ];
    }

    case "error":
      return typeof parsed.message === "string"
        ? [{ type: "error", kind: "unknown", raw: parsed.message }]
        : [];

    case "result": {
      const events: AgentEvent[] = [];
      const usage = usageFromStats(parsed.stats);
      if (usage) events.push(usage);
      const ok = parsed.status === "success";
      if (!ok) {
        events.push({
          type: "error",
          kind: "unknown",
          raw: parsed.error?.message ?? `gemini finished with status "${parsed.status ?? "unknown"}"`,
        });
      }
      events.push({ type: "done", ok, resultText: "" });
      return events;
    }

    default:
      return [];
  }
}

/** `-o json`: one object with `response`, `stats` and an optional `error`. */
export function parseGeminiFinalJson(text: string): AgentEvent[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  let parsed: GeminiLine;
  try {
    parsed = JSON.parse(trimmed) as GeminiLine;
  } catch {
    return [];
  }
  const events: AgentEvent[] = [];
  const usage = usageFromStats(parsed.stats);
  if (usage) events.push(usage);
  if (parsed.error?.message !== undefined) {
    events.push({ type: "error", kind: "unknown", raw: parsed.error.message });
    events.push({ type: "done", ok: false, resultText: parsed.response ?? "" });
    return events;
  }
  events.push({
    type: "done",
    ok: true,
    resultText: parsed.response ?? "",
    ...(parsed.session_id ? { sessionRef: parsed.session_id } : {}),
  });
  return events;
}
