import { execa } from "execa";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changedBetween, gitState, gitTouchedFiles, isGitRepo } from "./git.js";

const dirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "baton-git-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

async function initRepo(): Promise<string> {
  const cwd = temp();
  await execa("git", ["init", "-q"], { cwd });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd });
  await execa("git", ["config", "user.name", "Baton Test"], { cwd });
  return cwd;
}

describe("git snapshots", () => {
  it("says plainly when a folder is not a git repo", async () => {
    const cwd = temp();
    expect(await isGitRepo(cwd)).toBe(false);
    expect(await gitState(cwd)).toBeUndefined();
    expect(await gitTouchedFiles(cwd)).toBeUndefined();
  });

  it("sees a new file appear between two snapshots", async () => {
    const cwd = await initRepo();
    const before = await gitState(cwd);
    writeFileSync(path.join(cwd, "new-file.ts"), "export const x = 1;\n", "utf8");
    const after = await gitState(cwd);

    expect(await isGitRepo(cwd)).toBe(true);
    expect(changedBetween(before, after)).toEqual(["new-file.ts"]);
  });

  it("sees a tracked file change status", async () => {
    const cwd = await initRepo();
    writeFileSync(path.join(cwd, "a.txt"), "one\n", "utf8");
    await execa("git", ["add", "a.txt"], { cwd });
    await execa("git", ["commit", "-qm", "add a"], { cwd });

    const before = await gitState(cwd);
    writeFileSync(path.join(cwd, "a.txt"), "two\n", "utf8");
    const after = await gitState(cwd);
    expect(changedBetween(before, after)).toEqual(["a.txt"]);
  });

  it("reports nothing changed when nothing changed", async () => {
    const cwd = await initRepo();
    writeFileSync(path.join(cwd, "b.txt"), "b\n", "utf8");
    const before = await gitState(cwd);
    const after = await gitState(cwd);
    expect(changedBetween(before, after)).toEqual([]);
    expect(changedBetween(undefined, undefined)).toEqual([]);
  });

  it("lists touched files for the handoff, sorted and deduped", async () => {
    const cwd = await initRepo();
    writeFileSync(path.join(cwd, "z.txt"), "z\n", "utf8");
    writeFileSync(path.join(cwd, "a.txt"), "a\n", "utf8");
    expect(await gitTouchedFiles(cwd)).toEqual(["a.txt", "z.txt"]);
  });

  it("keeps the new path of a rename", async () => {
    const cwd = await initRepo();
    writeFileSync(path.join(cwd, "old.txt"), "x\n", "utf8");
    await execa("git", ["add", "old.txt"], { cwd });
    await execa("git", ["commit", "-qm", "add"], { cwd });
    await execa("git", ["mv", "old.txt", "new.txt"], { cwd });
    const state = await gitState(cwd);
    expect([...(state?.keys() ?? [])]).toContain("new.txt");
  });
});
