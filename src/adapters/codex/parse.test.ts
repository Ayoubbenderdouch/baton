import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { splitLines } from "../../core/stream.js";
import type { AgentEvent } from "../../core/types.js";
import { eventAt, firstEvent } from "../../test-utils/events.js";
import { buildCodexInvocation, buildCodexResumeInvocation, sandboxFor } from "./args.js";
import { parseCodexLine } from "./parse.js";

const fixture = (name: string): string =>
  readFileSync(path.join(process.cwd(), "fixtures", "codex", name), "utf8");

const events = (name: string): AgentEvent[] =>
  splitLines(fixture(name)).flatMap((line) => parseCodexLine(line));

describe("codex exec --json parsing (real 0.147.0 captures)", () => {
  it("maps a plain run to start -> text -> usage -> done", () => {
    const parsed = events("ok-stream.jsonl");
    expect(parsed.map((e) => e.type)).toEqual(["start", "text", "usage", "done"]);
    expect(eventAt(parsed, 0, "start").sessionRef).toBeTruthy();
    expect(eventAt(parsed, 1, "text").text).toBe("ok");
    expect(eventAt(parsed, 2, "usage")).toEqual({
      type: "usage",
      inputTokens: 15603,
      outputTokens: 5,
    });
    expect(eventAt(parsed, 3, "done").ok).toBe(true);
  });

  it("unwraps the shell wrapper codex puts around commands", () => {
    const tool = firstEvent(events("tool-stream.jsonl"), "tool");
    expect(tool).toEqual({ type: "tool", name: "shell", detail: "echo hi" });
  });

  it("unwraps double-quoted commands too (seen in a live run)", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: {
        id: "item_3",
        type: "command_execution",
        command: '/bin/zsh -lc "perl -pi -e \'chomp if eof\' hello.txt"',
        status: "in_progress",
      },
    });
    expect(parseCodexLine(line)).toEqual([
      { type: "tool", name: "shell", detail: "perl -pi -e 'chomp if eof' hello.txt" },
    ]);
  });

  it("reports turn.failed as an unjudged error for the classifier", () => {
    const parsed = events("turn-failed.jsonl");
    const error = firstEvent(parsed, "error");
    expect(error.kind).toBe("unknown");
    expect(error.raw).toContain("not supported when using Codex with a ChatGPT account");
    // A recovered `item.type: "error"` warning must not become an error event.
    expect(parsed.filter((e) => e.type === "error").length).toBe(2);
  });

  it("carries the 429 payload of a limited turn through to the classifier", () => {
    const error = firstEvent(events("limit.jsonl"), "error");
    expect(error.raw).toContain("429");
    expect(error.raw).toContain("usage limit");
  });

  it("ignores unknown line types and junk", () => {
    expect(parseCodexLine('{"type":"turn.started"}')).toEqual([]);
    expect(parseCodexLine('{"type":"something.new"}')).toEqual([]);
    expect(parseCodexLine("<<not json>>")).toEqual([]);
  });
});

describe("codex invocation", () => {
  const base = { prompt: "add a test", cwd: "/work/project", permissionLevel: "safe" as const };

  it("runs read-only in safe mode", () => {
    expect(sandboxFor(base)).toBe("read-only");
    const { args } = buildCodexInvocation(base);
    expect(args.slice(0, 4)).toEqual(["exec", "--json", "--sandbox", "read-only"]);
    expect(args.at(-1)).toBe("add a test");
  });

  it("allows workspace writes in auto mode but no bypass", () => {
    const { args } = buildCodexInvocation({ ...base, permissionLevel: "auto" });
    expect(args).toContain("workspace-write");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("only bypasses the sandbox behind --unsafe", () => {
    const { args } = buildCodexInvocation({ ...base, unsafe: true });
    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("--sandbox");
  });

  it("never passes --full-auto (not a flag of codex exec 0.147.0)", () => {
    expect(buildCodexInvocation({ ...base, permissionLevel: "auto" }).args).not.toContain(
      "--full-auto",
    );
  });

  it("resumes a thread by id", () => {
    const { args } = buildCodexResumeInvocation({ ...base, sessionRef: "thread-9" });
    expect(args.slice(0, 4)).toEqual(["exec", "resume", "thread-9", "--json"]);
  });

  it("feeds a very long prompt through stdin with the `-` marker", () => {
    const long = "y".repeat(9000);
    const invocation = buildCodexInvocation({ ...base, prompt: long });
    expect(invocation.args.at(-1)).toBe("-");
    expect(invocation.input).toBe(long);
  });
});
