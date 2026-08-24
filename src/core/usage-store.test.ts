import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UsageStore } from "./usage-store.js";

const dirs: string[] = [];
function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "baton-usage-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const NOW = new Date("2026-08-24T18:00:00.000Z");

describe("UsageStore", () => {
  it("records turns and limits, and reloads them", async () => {
    const home = tempHome();
    const store = await UsageStore.load(home);
    store.recordTurn({
      ts: NOW.toISOString(),
      agent: "codex",
      project: "/work/project",
      inputTokens: 88_000,
      outputTokens: 21_000,
      endedBy: "done",
    });
    store.recordLimit({
      ts: NOW.toISOString(),
      agent: "claude",
      project: "/work/project",
      resetHint: "resets 19:00",
    });
    await store.save(NOW);

    const reloaded = await UsageStore.load(home);
    expect(reloaded.usage.events).toHaveLength(1);
    expect(reloaded.lastLimit("claude")?.resetHint).toBe("resets 19:00");
    expect(reloaded.lastLimit("gemini")).toBeUndefined();
  });

  it("cools an agent down for the configured window", async () => {
    const store = await UsageStore.load(tempHome());
    store.recordLimit({
      ts: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
      agent: "claude",
      project: "/work/project",
    });
    expect(store.cooldown("claude", 30, NOW).cooling).toBe(true);
    expect(store.cooldown("claude", 5, NOW).cooling).toBe(false);
    expect(store.cooldown("codex", 30, NOW).cooling).toBe(false);
  });

  it("prefers the provider's own reset time when it is later than the window", async () => {
    const store = await UsageStore.load(tempHome());
    const resetsAt = Math.floor(NOW.getTime() / 1000) + 3 * 3600;
    store.recordLimit({
      ts: NOW.toISOString(),
      agent: "claude",
      project: "/work/project",
      resetsAt,
      resetHint: "resets 21:00",
    });
    const state = store.cooldown("claude", 30, NOW);
    expect(state.cooling).toBe(true);
    expect(state.until?.getTime()).toBe(resetsAt * 1000);
    expect(state.resetHint).toBe("resets 21:00");
  });

  it("ignores an earlier provider reset time rather than shortening the window", async () => {
    const store = await UsageStore.load(tempHome());
    store.recordLimit({
      ts: NOW.toISOString(),
      agent: "codex",
      project: "/work/project",
      resetsAt: Math.floor(NOW.getTime() / 1000) + 60,
    });
    const state = store.cooldown("codex", 30, NOW);
    expect(state.until?.getTime()).toBe(NOW.getTime() + 30 * 60_000);
  });

  it("prunes everything older than 90 days on write", async () => {
    const home = tempHome();
    const store = await UsageStore.load(home);
    store.recordTurn({
      ts: new Date(NOW.getTime() - 200 * 24 * 3600 * 1000).toISOString(),
      agent: "claude",
      project: "/work/project",
      endedBy: "done",
    });
    store.recordTurn({ ts: NOW.toISOString(), agent: "claude", project: "/w", endedBy: "done" });
    await store.save(NOW);
    expect((await UsageStore.load(home)).usage.events).toHaveLength(1);
  });

  it("keeps a corrupt usage.json as .bak and starts fresh", async () => {
    const home = tempHome();
    const file = path.join(home, "usage.json");
    writeFileSync(file, "not json", "utf8");
    const store = await UsageStore.load(home);
    expect(store.recovered).toBe(true);
    expect(store.usage.events).toEqual([]);
    expect(readFileSync(`${file}.bak`, "utf8")).toBe("not json");
  });
});
