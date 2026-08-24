import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { splitLines } from "../../core/stream.js";
import { eventAt, firstEvent } from "../../test-utils/events.js";
import type { AgentEvent } from "../../core/types.js";
import { buildClaudeInvocation } from "./args.js";
import {
  formatResetHint,
  isBlockedRateLimitStatus,
  parseClaudeFinalJson,
  parseClaudeLine,
} from "./parse.js";

const fixture = (name: string): string =>
  readFileSync(path.join(process.cwd(), "fixtures", "claude", name), "utf8");

function eventsOf(jsonl: string): AgentEvent[] {
  return splitLines(jsonl).flatMap((line) => parseClaudeLine(line));
}

describe("claude stream-json parsing (real 2.1.241 captures)", () => {
  it("maps a plain run to start -> text -> usage -> done", () => {
    const events = eventsOf(fixture("ok-stream.jsonl"));
    expect(events.map((e) => e.type)).toEqual(["start", "text", "usage", "done"]);
    const start = eventAt(events, 0, "start");
    expect(start.sessionRef).toBeTruthy();
    expect(eventAt(events, 1, "text").text).toBe("ok");
    const done = eventAt(events, 3, "done");
    expect(done.ok).toBe(true);
    expect(done.resultText).toBe("ok");
    expect(done.sessionRef).toBe(start.sessionRef);
  });

  it("keeps token usage from the final envelope without inventing numbers", () => {
    const usage = eventsOf(fixture("ok-stream.jsonl")).find((e) => e.type === "usage");
    expect(usage).toEqual({ type: "usage", inputTokens: 2, outputTokens: 4 });
  });

  it("maps tool calls with a human-readable detail", () => {
    const events = eventsOf(fixture("tool-stream.jsonl"));
    const tool = events.find((e) => e.type === "tool");
    expect(tool).toEqual({ type: "tool", name: "Bash", detail: "ls -la" });
    expect(events.filter((e) => e.type === "text").length).toBeGreaterThanOrEqual(2);
  });

  it("survives event types it has never seen (hooks, rate limit, unknown)", () => {
    expect(parseClaudeLine('{"type":"system","subtype":"hook_started"}')).toEqual([]);
    expect(parseClaudeLine('{"type":"brand_new_event_2027"}')).toEqual([]);
    expect(parseClaudeLine("not json at all")).toEqual([]);
    expect(parseClaudeLine("")).toEqual([]);
  });

  it("does not report a limit while the rate_limit_event says allowed", () => {
    const events = eventsOf(fixture("ok-stream.jsonl"));
    expect(events.some((e) => e.type === "limit")).toBe(false);
  });

  it("reads the `json` output format envelope the same way", () => {
    const events = parseClaudeFinalJson(fixture("ok-final.json"));
    expect(events.map((e) => e.type)).toEqual(["usage", "done"]);
    expect(eventAt(events, 1, "done").ok).toBe(true);
  });

  it("marks the crash envelope as a failed done", () => {
    const events = parseClaudeFinalJson(fixture("crash.json"));
    expect(firstEvent(events, "done").ok).toBe(false);
  });
});

describe("rate limit status classification", () => {
  it("treats healthy statuses as fine", () => {
    for (const status of ["allowed", "warning", "ok", "ACTIVE"]) {
      expect(isBlockedRateLimitStatus(status)).toBe(false);
    }
  });

  it("treats blocked wordings as a limit", () => {
    for (const status of ["rejected", "exhausted", "blocked", "limit_reached", "throttled"]) {
      expect(isBlockedRateLimitStatus(status)).toBe(true);
    }
  });

  it("stays silent on statuses it does not recognise (prefer unknown over a wrong relay)", () => {
    expect(isBlockedRateLimitStatus("some_future_status")).toBe(false);
    expect(isBlockedRateLimitStatus(undefined)).toBe(false);
  });

  it("turns resetsAt into a short hint", () => {
    expect(formatResetHint(1787619600, "UTC")).toBe("resets 01:00");
    expect(formatResetHint(undefined)).toBeUndefined();
    expect(formatResetHint(Number.NaN)).toBeUndefined();
  });
});

describe("claude invocation", () => {
  const base = { prompt: "do the thing", cwd: "/work/project", permissionLevel: "safe" as const };

  it("streams json and stays read-only in safe mode", () => {
    const { args } = buildClaudeInvocation(base);
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--allowedTools");
    expect(args).not.toContain("--permission-mode");
    expect(args.at(-2)).toBe("-p");
    expect(args.at(-1)).toBe("do the thing");
  });

  it("accepts edits in auto mode but never bypasses permissions", () => {
    const { args } = buildClaudeInvocation({ ...base, permissionLevel: "auto" });
    expect(args).toContain("--permission-mode");
    expect(args).toContain("acceptEdits");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("only reaches for the bypass flag when Baton's --unsafe is set", () => {
    const { args } = buildClaudeInvocation({ ...base, permissionLevel: "auto", unsafe: true });
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("never passes --max-turns (gone in claude 2.1.241)", () => {
    expect(buildClaudeInvocation(base).args).not.toContain("--max-turns");
  });

  it("resumes a provider session when asked", () => {
    const { args } = buildClaudeInvocation({ ...base, sessionRef: "abc-123" });
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--resume") + 1]).toBe("abc-123");
  });

  it("moves very long prompts to stdin (Windows argv limit)", () => {
    const long = "x".repeat(9000);
    const invocation = buildClaudeInvocation({ ...base, prompt: long });
    expect(invocation.input).toBe(long);
    expect(invocation.args.at(-1)).toBe("-p");
  });
});
