import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeLine } from "./claude/parse.js";
import { runProvider } from "./shared.js";
import { collect, firstEvent } from "../test-utils/events.js";
import type { AgentEvent, RunRequest } from "../core/types.js";

const FAKE_CLI = path.join(process.cwd(), "fixtures", "fake-cli", "emit.mjs");
const OK_STREAM = path.join(process.cwd(), "fixtures", "claude", "ok-stream.jsonl");

const request: RunRequest = { prompt: "task", cwd: process.cwd(), permissionLevel: "safe" };

function runFake(args: string[]): Promise<AgentEvent[]> {
  const handle = runProvider(
    {
      id: "claude",
      // The fake CLI is node itself — resolveBin finds `node` on every runner.
      binName: "node",
      installCommand: "install node",
      invocation: { args: [FAKE_CLI, ...args] },
      parseLine: parseClaudeLine,
    },
    request,
  );
  return collect(handle.events);
}

describe("runProvider (spawn -> parse -> events, no real provider involved)", () => {
  it("streams a real capture end to end", async () => {
    const events = await runFake([OK_STREAM]);
    expect(events.map((e) => e.type)).toEqual(["start", "text", "usage", "done"]);
    expect(firstEvent(events, "done").ok).toBe(true);
  });

  it("handles CRLF line endings the same way (Windows pipes)", async () => {
    const events = await runFake([OK_STREAM, "--crlf"]);
    expect(events.map((e) => e.type)).toEqual(["start", "text", "usage", "done"]);
    expect(firstEvent(events, "text").text).toBe("ok");
  });

  it("reports a missing CLI as not_installed with the install command", async () => {
    const handle = runProvider(
      {
        id: "codex",
        binName: "definitely-not-installed-baton-test",
        installCommand: "npm i -g @openai/codex",
        invocation: { args: [] },
        parseLine: parseClaudeLine,
      },
      request,
    );
    const events = await collect(handle.events);
    const error = firstEvent(events, "error");
    expect(error.kind).toBe("not_installed");
    expect(error.raw).toContain("npm i -g @openai/codex");
    expect(firstEvent(events, "done").ok).toBe(false);
  });

  it("classifies a sign-in failure from stderr instead of calling it a crash", async () => {
    const events = await runFake([
      "--exit",
      "1",
      "--stderr",
      "Error: not logged in. Please log in and try again.",
    ]);
    expect(firstEvent(events, "error").kind).toBe("auth");
  });

  it("calls an unexplained non-zero exit a crash, never a limit", async () => {
    const events = await runFake(["--exit", "9", "--stderr", "segfault in the frobnicator"]);
    expect(firstEvent(events, "error").kind).toBe("crash");
    expect(events.some((e) => e.type === "limit")).toBe(false);
  });

  it("cancel() stops a hanging CLI and still closes the stream", async () => {
    const handle = runProvider(
      {
        id: "claude",
        binName: "node",
        installCommand: "install node",
        invocation: { args: [FAKE_CLI, OK_STREAM, "--hang"] },
        parseLine: parseClaudeLine,
      },
      request,
    );
    const events: AgentEvent[] = [];
    for await (const event of handle.events) {
      events.push(event);
      if (event.type === "usage") void handle.cancel();
    }
    expect(events.some((e) => e.type === "start")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  }, 20_000);

  it("passes raw lines through when --verbose asked for them", async () => {
    const seen: string[] = [];
    const handle = runProvider(
      {
        id: "claude",
        binName: "node",
        installCommand: "install node",
        invocation: { args: [FAKE_CLI, OK_STREAM] },
        parseLine: parseClaudeLine,
      },
      { ...request, onRawLine: (_source, line) => seen.push(line) },
    );
    await collect(handle.events);
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.some((line) => line.includes('"type":"result"'))).toBe(true);
  });
});

describe("limit detection through the whole pipeline", () => {
  const fixturePath = (agent: string, name: string): string =>
    path.join(process.cwd(), "fixtures", agent, name);

  async function runReplay(
    agent: "claude" | "codex" | "gemini",
    parse: (line: string) => AgentEvent[],
    file: string,
    extra: string[] = [],
  ): Promise<AgentEvent[]> {
    const handle = runProvider(
      {
        id: agent,
        binName: "node",
        installCommand: "install node",
        invocation: { args: [FAKE_CLI, file, ...extra] },
        parseLine: parse,
      },
      request,
    );
    return collect(handle.events);
  }

  it("claude: a blocked rate_limit_event becomes one limit event with a reset hint", async () => {
    const events = await runReplay(
      "claude",
      parseClaudeLine,
      fixturePath("claude", "limit-stream.jsonl"),
    );
    const limits = events.filter((e) => e.type === "limit");
    expect(limits).toHaveLength(1);
    const limit = firstEvent(events, "limit");
    expect(limit.resetHint).toBeDefined();
    expect(limit.raw).toContain("resetsAt=");
    expect(firstEvent(events, "done").ok).toBe(false);
  });

  it("codex: a 429 inside turn.failed becomes exactly one limit event, not two", async () => {
    const { parseCodexLine } = await import("./codex/parse.js");
    const events = await runReplay(
      "codex",
      parseCodexLine,
      fixturePath("codex", "limit.jsonl"),
      ["--exit", "1"],
    );
    expect(events.filter((e) => e.type === "limit")).toHaveLength(1);
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
    expect(firstEvent(events, "limit").resetHint).toBe("try again in 3 hours 12 minutes");
  });

  it("gemini: RESOURCE_EXHAUSTED becomes a limit, and the run ends not-ok", async () => {
    const { parseGeminiLine } = await import("./gemini/parse.js");
    const events = await runReplay(
      "gemini",
      parseGeminiLine,
      fixturePath("gemini", "limit.jsonl"),
      ["--exit", "1"],
    );
    expect(events.filter((e) => e.type === "limit")).toHaveLength(1);
    expect(firstEvent(events, "done").ok).toBe(false);
  });

  it("a transient error line does not override a provider's own success verdict", async () => {
    const { parseGeminiLine } = await import("./gemini/parse.js");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(path.join(tmpdir(), "baton-transient-"));
    const file = path.join(dir, "transient.jsonl");
    writeFileSync(
      file,
      [
        '{"type":"init","session_id":"s1","model":"auto-gemini-3"}',
        '{"type":"error","message":"transient network blip, retrying"}',
        '{"type":"message","role":"assistant","content":"recovered and done"}',
        '{"type":"result","status":"success","stats":{"input_tokens":10,"output_tokens":2}}',
      ].join("\n"),
      "utf8",
    );
    const events = await runReplay("gemini", parseGeminiLine, file);
    expect(firstEvent(events, "done").ok).toBe(true);
    expect(firstEvent(events, "done").resultText).toBe("recovered and done");
  });

  it("BATON_TEST_FORCE_LIMIT reports a limit without spawning anything", async () => {
    process.env.BATON_TEST_FORCE_LIMIT = "codex";
    try {
      const handle = runProvider(
        {
          id: "codex",
          // A binary that does not exist proves nothing was spawned.
          binName: "definitely-not-installed-baton-test",
          installCommand: "n/a",
          invocation: { args: [] },
          parseLine: parseClaudeLine,
        },
        request,
      );
      const events = await collect(handle.events);
      expect(events.map((e) => e.type)).toEqual(["start", "text", "limit", "done"]);
      expect(firstEvent(events, "limit").raw).toContain("BATON_TEST_FORCE_LIMIT");
    } finally {
      delete process.env.BATON_TEST_FORCE_LIMIT;
    }
  });
});
