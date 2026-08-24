import type { AgentEvent } from "../../core/types.js";

/**
 * Codex CLI `exec --json` parsing.
 * Shapes verified against codex-cli 0.147.0 — see fixtures/codex/.
 */

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  message?: string;
}

interface CodexLine {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  message?: string;
  error?: { message?: string };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
  };
}

function commandDetail(item: CodexItem): string | undefined {
  const command = item.command;
  if (typeof command !== "string" || command.trim() === "") return undefined;
  // Codex wraps commands as `/bin/zsh -lc '…'` — show what the user would recognise.
  const wrapped = /^\S*(?:sh|zsh|bash)\s+-l?c\s+'([\s\S]+)'$/.exec(command.trim());
  return (wrapped?.[1] ?? command).trim();
}

export function parseCodexLine(line: string): AgentEvent[] {
  const trimmed = line.trim();
  if (trimmed === "") return [];
  let parsed: CodexLine;
  try {
    parsed = JSON.parse(trimmed) as CodexLine;
  } catch {
    return [];
  }

  switch (parsed.type) {
    case "thread.started":
      return parsed.thread_id ? [{ type: "start", sessionRef: parsed.thread_id }] : [{ type: "start" }];

    case "item.started":
    case "item.updated":
    case "item.completed": {
      const item = parsed.item;
      if (item === undefined) return [];
      if (item.type === "agent_message" && parsed.type === "item.completed") {
        return typeof item.text === "string" && item.text !== ""
          ? [{ type: "text", text: item.text }]
          : [];
      }
      if (item.type === "command_execution" && parsed.type === "item.started") {
        const detail = commandDetail(item);
        return [{ type: "tool", name: "shell", ...(detail ? { detail } : {}) }];
      }
      if (item.type === "file_change" && parsed.type === "item.started") {
        return [{ type: "tool", name: "edit" }];
      }
      if (item.type === "mcp_tool_call" && parsed.type === "item.started") {
        return [{ type: "tool", name: "mcp" }];
      }
      // `item.type: "error"` is often a warning the turn recovers from (a model
      // metadata notice, for example) — the fatal one always arrives as turn.failed.
      return [];
    }

    case "turn.completed": {
      const events: AgentEvent[] = [];
      const usage = parsed.usage;
      if (usage && (usage.input_tokens !== undefined || usage.output_tokens !== undefined)) {
        events.push({
          type: "usage",
          ...(usage.input_tokens !== undefined ? { inputTokens: usage.input_tokens } : {}),
          ...(usage.output_tokens !== undefined ? { outputTokens: usage.output_tokens } : {}),
        });
      }
      events.push({ type: "done", ok: true, resultText: "" });
      return events;
    }

    case "turn.failed": {
      const raw = parsed.error?.message ?? "codex turn failed without an error message";
      return [{ type: "error", kind: "unknown", raw }];
    }

    case "error":
      // Top-level errors duplicate turn.failed; keep the text for classification only.
      return typeof parsed.message === "string"
        ? [{ type: "error", kind: "unknown", raw: parsed.message }]
        : [];

    default:
      return [];
  }
}
