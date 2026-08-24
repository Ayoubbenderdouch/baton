import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordTurnInSummary, refreshHandoff } from "./handoff-refresh.js";
import { SessionStore } from "./session-store.js";

const dirs: string[] = [];
function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "baton-handoff-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe("refreshHandoff", () => {
  it("writes the briefing to the project root and mirrors it into .baton/", async () => {
    const cwd = tempProject();
    const store = await SessionStore.load(cwd);
    store.startTask("port the parser to TypeScript");
    store.appendTurn({
      ts: "2026-08-24T21:00:00.000Z",
      agent: "claude",
      promptPreview: "port the parser to TypeScript",
      resultSummary: "converted the tokenizer and its tests",
      filesChanged: ["src/tokenizer.ts"],
      endedBy: "limit",
    });
    recordTurnInSummary(store, "converted the tokenizer and its tests");

    const paths = await refreshHandoff(cwd, store, {
      maxRelays: 2,
      now: "2026-08-24T21:05:00.000Z",
    });

    expect(paths.rootPath).toBe(path.join(cwd, "HANDOFF.md"));
    expect(paths.mirrorPath).toBe(path.join(cwd, ".baton", "HANDOFF.md"));
    const root = readFileSync(paths.rootPath, "utf8");
    expect(readFileSync(paths.mirrorPath, "utf8")).toBe(root);
    expect(root).toContain("# HANDOFF — 2026-08-24T21:05:00.000Z");
    expect(root).toContain("port the parser to TypeScript");
    expect(root).toContain("- Previous agent: claude (stopped: usage limit)");
    expect(root).toContain("- converted the tokenizer and its tests");
    expect(root).toContain("stopped mid-task when its usage limit hit");
    // A temp folder is not a git repo, and the briefing says so instead of guessing.
    expect(root).toContain("(not a git repo)");
  });

  it("is byte-identical when nothing changed but the clock", async () => {
    const cwd = tempProject();
    const store = await SessionStore.load(cwd);
    store.startTask("same task");
    const first = await refreshHandoff(cwd, store, { maxRelays: 2, now: "T1" });
    const firstText = readFileSync(first.rootPath, "utf8");
    const second = await refreshHandoff(cwd, store, { maxRelays: 2, now: "T1" });
    expect(readFileSync(second.rootPath, "utf8")).toBe(firstText);
  });

  it("keeps Arabic and emoji intact through the whole write path", async () => {
    const cwd = tempProject();
    const store = await SessionStore.load(cwd);
    const task = readFileSync(path.join(process.cwd(), "fixtures", "unicode-task.txt"), "utf8");
    store.startTask(task);
    const paths = await refreshHandoff(cwd, store, { maxRelays: 2, now: "T1" });
    const written = readFileSync(paths.rootPath, "utf8");
    expect(written).toContain("أصلح اختبار المصادقة المتقطع");
    expect(written).toContain("🏃⚡");
    expect(written.includes("\r\n")).toBe(false);
  });
});
