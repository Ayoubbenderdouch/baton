import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { splitLines } from "../../core/stream.js";
import type { AgentEvent } from "../../core/types.js";
import { eventAt, firstEvent } from "../../test-utils/events.js";
import {
  GEMINI_NON_INTERACTIVE_PREAMBLE,
  approvalModeFor,
  buildGeminiInvocation,
} from "./args.js";
import { parseGeminiFinalJson, parseGeminiLine } from "./parse.js";

const fixture = (name: string): string =>
  readFileSync(path.join(process.cwd(), "fixtures", "gemini", name), "utf8");

const events = (name: string): AgentEvent[] =>
  splitLines(fixture(name)).flatMap((line) => parseGeminiLine(line));

describe("gemini stream-json parsing (real 0.56.0 captures)", () => {
  it("maps a plain run to start -> text -> usage -> done", () => {
    const parsed = events("ok-stream.jsonl");
    expect(parsed.map((e) => e.type)).toEqual(["start", "text", "usage", "done"]);
    expect(eventAt(parsed, 1, "text").text).toBe("ok");
    expect(eventAt(parsed, 2, "usage")).toEqual({
      type: "usage",
      inputTokens: 9421,
      outputTokens: 34,
    });
    expect(eventAt(parsed, 3, "done").ok).toBe(true);
  });

  it("ignores the echoed user message", () => {
    expect(events("ok-stream.jsonl").filter((e) => e.type === "text")).toHaveLength(1);
  });

  it("maps tool calls with their command", () => {
    const tool = firstEvent(events("tool-stream.jsonl"), "tool");
    expect(tool).toEqual({ type: "tool", name: "run_shell_command", detail: "ls -la" });
  });

  it("turns a quota error into an unjudged error plus a failed done", () => {
    const parsed = events("limit.jsonl");
    const error = firstEvent(parsed, "error");
    expect(error.raw).toContain("RESOURCE_EXHAUSTED");
    expect(firstEvent(parsed, "done").ok).toBe(false);
  });

  it("reads the -o json envelope, summing per-model token counts", () => {
    const parsed = parseGeminiFinalJson(fixture("ok-final.json"));
    const usage = firstEvent(parsed, "usage");
    expect(usage.inputTokens).toBe(835 + 8586);
    expect(usage.outputTokens).toBe(26 + 1);
    const done = firstEvent(parsed, "done");
    expect(done.ok).toBe(true);
    expect(done.resultText).toBe("ok");
  });

  it("ignores junk and unknown types", () => {
    expect(parseGeminiLine('{"type":"heartbeat"}')).toEqual([]);
    expect(parseGeminiLine("nope")).toEqual([]);
    expect(parseGeminiFinalJson("")).toEqual([]);
  });
});

describe("gemini invocation", () => {
  const base = { prompt: "summarise this repo", cwd: "/work/project", permissionLevel: "safe" as const };

  it("stays read-only in safe mode", () => {
    expect(approvalModeFor(base)).toBe("plan");
  });

  it("uses auto_edit for auto mode — yolo is reserved for --unsafe", () => {
    expect(approvalModeFor({ ...base, permissionLevel: "auto" })).toBe("auto_edit");
    expect(approvalModeFor({ ...base, permissionLevel: "auto", unsafe: true })).toBe("yolo");
    expect(buildGeminiInvocation({ ...base, permissionLevel: "auto" }).args).not.toContain("yolo");
  });

  it("prepends the never-ask preamble to every prompt", () => {
    const { args } = buildGeminiInvocation(base);
    expect(args.at(-1)).toBe(`${GEMINI_NON_INTERACTIVE_PREAMBLE}\n\nsummarise this repo`);
    expect(args).toContain("stream-json");
  });

  it("moves a long prompt to stdin", () => {
    const invocation = buildGeminiInvocation({ ...base, prompt: "z".repeat(9000) });
    expect(invocation.input).toContain(GEMINI_NON_INTERACTIVE_PREAMBLE);
    expect(invocation.args.at(-1)).toBe("");
  });
});
