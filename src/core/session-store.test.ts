import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore, truncate } from "./session-store.js";

const dirs: string[] = [];
function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "baton-session-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe("SessionStore", () => {
  it("starts empty and persists a turn", async () => {
    const cwd = tempProject();
    const store = await SessionStore.load(cwd);
    store.startTask("fix the flaky auth test");
    store.appendTurn({
      ts: "2026-08-24T10:00:00.000Z",
      agent: "claude",
      promptPreview: "fix the flaky auth test",
      resultSummary: "found a shared fixture",
      filesChanged: ["src/auth.test.ts"],
      endedBy: "done",
    });
    await store.save();

    const reloaded = await SessionStore.load(cwd);
    expect(reloaded.session.task).toBe("fix the flaky auth test");
    expect(reloaded.session.turns).toHaveLength(1);
    expect(reloaded.lastTurn()?.agent).toBe("claude");
    expect(reloaded.recovered).toBe(false);
  });

  it("keeps a corrupt session file as .bak and starts fresh instead of crashing", async () => {
    const cwd = tempProject();
    mkdirSync(path.join(cwd, ".baton"), { recursive: true });
    const file = path.join(cwd, ".baton", "session.json");
    writeFileSync(file, "{ this is not json", "utf8");

    const store = await SessionStore.load(cwd);
    expect(store.recovered).toBe(true);
    expect(store.session.turns).toEqual([]);
    expect(readFileSync(`${file}.bak`, "utf8")).toBe("{ this is not json");
  });

  it("remembers which agents already hit a limit for this task", async () => {
    const store = await SessionStore.load(tempProject());
    store.startTask("build the thing");
    store.appendTurn({
      ts: "2026-08-24T10:00:00.000Z",
      agent: "claude",
      promptPreview: "build the thing",
      resultSummary: "",
      filesChanged: [],
      endedBy: "limit",
    });
    expect(store.session.limitedAgents).toEqual(["claude"]);
  });

  it("resets relay bookkeeping when the task changes", async () => {
    const store = await SessionStore.load(tempProject());
    store.startTask("task one");
    store.countRelay();
    store.appendTurn({
      ts: "2026-08-24T10:00:00.000Z",
      agent: "claude",
      promptPreview: "task one",
      resultSummary: "",
      filesChanged: [],
      endedBy: "limit",
    });
    store.startTask("task two");
    expect(store.session.relayCount).toBe(0);
    expect(store.session.limitedAgents).toEqual([]);
    // History is kept: a new task does not erase what happened before.
    expect(store.session.turns).toHaveLength(1);
  });

  it("enforces the preview and summary limits at write time", async () => {
    const store = await SessionStore.load(tempProject());
    store.appendTurn({
      ts: "2026-08-24T10:00:00.000Z",
      agent: "gemini",
      promptPreview: "x".repeat(400),
      resultSummary: "y".repeat(900),
      filesChanged: [],
      endedBy: "done",
    });
    const turn = store.lastTurn();
    expect(turn?.promptPreview.length).toBe(200);
    expect(turn?.resultSummary.length).toBe(500);
  });

  it("truncate collapses whitespace, including Arabic text", () => {
    expect(truncate("  a   b \n c ", 100)).toBe("a b c");
    expect(truncate("أصلح اختبار المصادقة المتقطع", 10)).toBe("أصلح اختب…");
  });
});
