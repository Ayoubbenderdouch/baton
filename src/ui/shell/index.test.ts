import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startShell } from "./index.js";

describe("the shell never opens outside a terminal", () => {
  it("declines in a pipe and says why", async () => {
    // Under vitest stdout is already a pipe, so isTTY is undefined — set it explicitly
    // either way so the test states its own precondition.
    const original = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    try {
      await expect(startShell(process.cwd())).resolves.toEqual({
        started: false,
        reason: "not a terminal",
      });
    } finally {
      if (original !== undefined) Object.defineProperty(process.stdout, "isTTY", original);
    }
  });

  it("is imported lazily, so a piped `baton run` never loads ink or react", () => {
    const program = readFileSync(path.join("src", "cli", "program.ts"), "utf8");
    // A static import would pull React into every invocation.
    expect(program).not.toMatch(/^import .*shell/m);
    expect(program).toContain('await import("../ui/shell/index.js")');
  });

  it("keeps the palette out of the non-interactive renderer", () => {
    const renderer = readFileSync(path.join("src", "ui", "run-renderer.ts"), "utf8");
    expect(renderer).not.toContain("palette");
    expect(renderer).not.toContain("commands.js");
  });
});
