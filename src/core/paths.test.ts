import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { batonHome, readJsonFile, writeFileAtomic } from "./paths.js";

const original = process.env.BATON_HOME;
const dirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "baton-paths-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  if (original === undefined) delete process.env.BATON_HOME;
  else process.env.BATON_HOME = original;
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe("baton home", () => {
  it("defaults to ~/.baton via os.homedir()", () => {
    delete process.env.BATON_HOME;
    expect(batonHome()).toBe(path.join(os.homedir(), ".baton"));
  });

  it("honors BATON_HOME so tests never touch the real home", () => {
    const dir = temp();
    process.env.BATON_HOME = dir;
    expect(batonHome()).toBe(path.resolve(dir));
  });
});

describe("writeFileAtomic", () => {
  it("creates missing directories and writes utf8", async () => {
    const file = path.join(temp(), "nested", "deep", "config.json");
    await writeFileAtomic(file, '{"chain":["claude"],"note":"مرحبا 👋"}');
    expect(readFileSync(file, "utf8")).toContain("مرحبا 👋");
  });

  it("overwrites an existing file (the Windows rename-over case)", async () => {
    const file = path.join(temp(), "state.json");
    writeFileSync(file, "old", "utf8");
    await writeFileAtomic(file, "new");
    expect(readFileSync(file, "utf8")).toBe("new");
  });

  it("leaves no .tmp files behind", async () => {
    const dir = temp();
    const file = path.join(dir, "a.json");
    await writeFileAtomic(file, "1");
    await writeFileAtomic(file, "2");
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("readJsonFile", () => {
  it("returns undefined for a missing file and for garbage", async () => {
    const dir = temp();
    expect(await readJsonFile(path.join(dir, "nope.json"))).toBeUndefined();
    const broken = path.join(dir, "broken.json");
    writeFileSync(broken, "{oops", "utf8");
    expect(await readJsonFile(broken)).toBeUndefined();
  });
});
