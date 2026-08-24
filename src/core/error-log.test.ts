import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lastErrorLogPath, writeLastError } from "./error-log.js";

const original = process.env.BATON_HOME;
const dirs: string[] = [];
afterEach(() => {
  if (original === undefined) delete process.env.BATON_HOME;
  else process.env.BATON_HOME = original;
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "baton-errlog-"));
  dirs.push(dir);
  process.env.BATON_HOME = dir;
  return dir;
}

describe("last-error.log", () => {
  it("writes the full detail where the message says it is", async () => {
    const home = tempHome();
    const file = await writeLastError(new Error("everything broke"), 'run "do the thing"');
    expect(file).toBe(path.join(home, "last-error.log"));
    expect(file).toBe(lastErrorLogPath());
    const contents = readFileSync(file, "utf8");
    expect(contents).toContain("everything broke");
    expect(contents).toContain('run "do the thing"');
    expect(contents).toContain("Error:");
  });

  it("handles a thrown non-Error without losing it", async () => {
    tempHome();
    const file = await writeLastError("just a string", "status");
    expect(readFileSync(file, "utf8")).toContain("just a string");
  });

  it("never throws when the log cannot be written", async () => {
    // A path that cannot be a directory: writing must fail silently.
    process.env.BATON_HOME = path.join(tempHome(), "file-in-the-way", "x");
    await expect(writeLastError(new Error("x"), "ctx")).resolves.toContain("last-error.log");
  });
});
