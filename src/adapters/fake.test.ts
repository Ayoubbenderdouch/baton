import { afterEach, describe, expect, it } from "vitest";
import { createBuiltInFakeAdapter, fakeModeEnabled } from "./fake.js";
import { getAdapter } from "./registry.js";
import { collect, firstEvent } from "../test-utils/events.js";
import type { RunRequest } from "../core/types.js";

const request: RunRequest = { prompt: "do the thing", cwd: "/work/project", permissionLevel: "safe" };

afterEach(() => {
  delete process.env.BATON_TEST_FAKE;
  delete process.env.BATON_TEST_FORCE_LIMIT;
});

describe("BATON_TEST_FAKE (the README's 'try it with nothing installed' path)", () => {
  it("is off unless the variable is exactly 1", () => {
    expect(fakeModeEnabled()).toBe(false);
    process.env.BATON_TEST_FAKE = "0";
    expect(fakeModeEnabled()).toBe(false);
    process.env.BATON_TEST_FAKE = "true";
    expect(fakeModeEnabled()).toBe(false);
    process.env.BATON_TEST_FAKE = "1";
    expect(fakeModeEnabled()).toBe(true);
  });

  it("swaps the registry for fakes only while it is set", () => {
    expect(getAdapter("claude").displayName).toBe("Claude Code");
    process.env.BATON_TEST_FAKE = "1";
    expect(getAdapter("claude").displayName).toBe("claude (fake)");
  });

  it("reports ready without touching any provider CLI", async () => {
    const detected = await createBuiltInFakeAdapter("codex").detect();
    expect(detected).toMatchObject({ id: "codex", verdict: "ready", installed: true });
    expect(detected.detail).toBe("BATON_TEST_FAKE=1");
  });

  it("runs a whole turn: start -> text -> usage -> done", async () => {
    const events = await collect(createBuiltInFakeAdapter("gemini").run(request).events);
    expect(events.map((e) => e.type)).toEqual(["start", "text", "usage", "done"]);
    const done = firstEvent(events, "done");
    expect(done.ok).toBe(true);
    expect(done.resultText).toContain("do the thing");
    expect(done.sessionRef).toBe("fake-gemini");
  });

  it("composes with BATON_TEST_FORCE_LIMIT so the relay works with nothing installed", async () => {
    process.env.BATON_TEST_FORCE_LIMIT = "claude";
    const limited = await collect(createBuiltInFakeAdapter("claude").run(request).events);
    expect(limited.map((e) => e.type)).toEqual(["start", "text", "limit", "done"]);
    expect(firstEvent(limited, "limit").resetHint).toContain("simulated");
    expect(firstEvent(limited, "done").ok).toBe(false);

    // The agent that is NOT forced still finishes normally — that is the relay target.
    const target = await collect(createBuiltInFakeAdapter("codex").run(request).events);
    expect(firstEvent(target, "done").ok).toBe(true);
  });

  it("cancel() resolves even though nothing was spawned", async () => {
    await expect(createBuiltInFakeAdapter("claude").run(request).cancel()).resolves.toBeUndefined();
  });
});
