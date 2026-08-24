import type { AgentAdapter, AgentId, PermissionLevel } from "./types.js";
import type { RunRenderer } from "../ui/run-renderer.js";
import { changedBetween, gitState } from "./git.js";

export interface TurnOutcome {
  agent: AgentId;
  endedBy: "done" | "limit" | "error" | "cancel";
  resultText: string;
  filesChanged: string[];
  usage?: { inputTokens?: number; outputTokens?: number };
  sessionRef?: string;
  limit?: { raw: string; resetHint?: string };
  error?: { kind: "auth" | "not_installed" | "crash" | "unknown"; raw: string };
  durationMs: number;
}

export interface TurnOptions {
  adapter: AgentAdapter;
  prompt: string;
  cwd: string;
  permissionLevel: PermissionLevel;
  renderer: RunRenderer;
  unsafe?: boolean;
  extraArgs?: string[];
  timeoutMs?: number;
  sessionRef?: string;
  verbose?: boolean;
  signal?: AbortSignal;
}

/**
 * One agent, one turn: spawn it, render its events live, and report what happened in
 * provider-agnostic terms. Everything above this function (failover, routing) only ever
 * sees a TurnOutcome — never a provider's own output format.
 */
export async function runTurn(options: TurnOptions): Promise<TurnOutcome> {
  const { adapter, renderer } = options;
  const startedAt = Date.now();
  const before = await gitState(options.cwd);

  const handle = adapter.run({
    prompt: options.prompt,
    cwd: options.cwd,
    permissionLevel: options.permissionLevel,
    ...(options.sessionRef !== undefined ? { sessionRef: options.sessionRef } : {}),
    ...(options.unsafe !== undefined ? { unsafe: options.unsafe } : {}),
    ...(options.extraArgs !== undefined ? { extraArgs: options.extraArgs } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.verbose === true
      ? { onRawLine: (source, line) => renderer.raw(source, line) }
      : {}),
  });

  let cancelled = false;
  const onAbort = (): void => {
    cancelled = true;
    void handle.cancel();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  renderer.agentStart(adapter.id);

  let resultText = "";
  let sessionRef: string | undefined = options.sessionRef;
  let usage: TurnOutcome["usage"];
  let limit: TurnOutcome["limit"];
  let error: TurnOutcome["error"];
  let ok = false;

  try {
    for await (const event of handle.events) {
      renderer.event(event);
      switch (event.type) {
        case "start":
          if (event.sessionRef !== undefined) sessionRef = event.sessionRef;
          break;
        case "text":
          resultText = event.text;
          break;
        case "usage":
          usage = {
            ...(event.inputTokens !== undefined ? { inputTokens: event.inputTokens } : {}),
            ...(event.outputTokens !== undefined ? { outputTokens: event.outputTokens } : {}),
          };
          break;
        case "limit":
          limit = {
            raw: event.raw,
            ...(event.resetHint !== undefined ? { resetHint: event.resetHint } : {}),
          };
          break;
        case "error":
          error = { kind: event.kind, raw: event.raw };
          break;
        case "done":
          ok = event.ok;
          if (event.resultText !== "") resultText = event.resultText;
          if (event.sessionRef !== undefined) sessionRef = event.sessionRef;
          break;
        case "tool":
          break;
      }
    }
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }

  const after = await gitState(options.cwd);
  const endedBy: TurnOutcome["endedBy"] = cancelled
    ? "cancel"
    : limit !== undefined
      ? "limit"
      : error !== undefined || !ok
        ? "error"
        : "done";

  return {
    agent: adapter.id,
    endedBy,
    resultText,
    filesChanged: changedBetween(before, after),
    durationMs: Date.now() - startedAt,
    ...(usage !== undefined ? { usage } : {}),
    ...(sessionRef !== undefined ? { sessionRef } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}
