import { afterEach, describe, expect, it } from "vitest";
import { allAdapters, getAdapter } from "./registry.js";
import { collect, firstEvent } from "../test-utils/events.js";
import { AGENT_IDS, type RunRequest } from "../core/types.js";

const originalPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = originalPath;
});

const request: RunRequest = { prompt: "task", cwd: process.cwd(), permissionLevel: "safe" };

describe("adapter wiring (the real classes, no provider installed)", () => {
  it("registers exactly the three agents, in chain order", () => {
    expect(allAdapters().map((adapter) => adapter.id)).toEqual([...AGENT_IDS]);
    expect(allAdapters().map((adapter) => adapter.displayName)).toEqual([
      "Claude Code",
      "Codex CLI",
      "Gemini CLI",
    ]);
  });

  it.each([...AGENT_IDS])(
    "%s: run() reports not_installed with the provider's own install command",
    async (id) => {
      process.env.PATH = "/definitely/not/a/real/path";
      const events = await collect(getAdapter(id).run(request).events);
      const error = firstEvent(events, "error");
      expect(error.kind).toBe("not_installed");
      expect(error.raw).toContain("npm i -g");
      expect(firstEvent(events, "done").ok).toBe(false);
    },
  );

  it.each([...AGENT_IDS])("%s: detect() reports not_installed off an empty PATH", async (id) => {
    process.env.PATH = "/definitely/not/a/real/path";
    const detected = await getAdapter(id).detect();
    expect(detected).toMatchObject({ id, installed: false, verdict: "not_installed" });
    expect(detected.remedy).toContain("npm i -g");
  });

  it("only claude and codex offer native resume; gemini is stateless by design", () => {
    expect(typeof getAdapter("claude").buildResumeArgs).toBe("function");
    expect(typeof getAdapter("codex").buildResumeArgs).toBe("function");
    expect(getAdapter("gemini").buildResumeArgs).toBeUndefined();
  });

  it("claude's resume args carry the session id", () => {
    const args = getAdapter("claude").buildResumeArgs?.("session-42", "carry on") ?? [];
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--resume") + 1]).toBe("session-42");
    expect(args.at(-1)).toBe("carry on");
  });

  it("codex's resume args put the thread id first", () => {
    const args = getAdapter("codex").buildResumeArgs?.("thread-42", "carry on") ?? [];
    expect(args.slice(0, 3)).toEqual(["exec", "resume", "thread-42"]);
    expect(args.at(-1)).toBe("carry on");
  });

  it("cancel() is safe on a run that never spawned anything", async () => {
    process.env.PATH = "/definitely/not/a/real/path";
    await expect(getAdapter("gemini").run(request).cancel()).resolves.toBeUndefined();
  });
});
