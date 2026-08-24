import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyFailure, explainFailure, gateRemedy } from "./shared.js";

const fixture = (agent: string, name: string): string =>
  readFileSync(path.join(process.cwd(), "fixtures", agent, name), "utf8");

describe("provider safety gates", () => {
  it("explains gemini's untrusted-folder refusal instead of calling it a crash", () => {
    const remedy = gateRemedy(fixture("gemini", "trust-error.txt"));
    expect(remedy).toContain("gemini does not trust this folder");
    expect(remedy).toContain("--skip-trust");
  });

  it("explains codex's git-repo requirement", () => {
    const remedy = gateRemedy(fixture("codex", "git-repo-required.txt"));
    expect(remedy).toContain("only runs inside a git repository");
    expect(remedy).toContain("--skip-git-repo-check");
  });

  it("puts the remedy on the first line of the error the user sees", () => {
    const explained = explainFailure(fixture("gemini", "trust-error.txt"));
    expect(explained.kind).toBe("crash");
    expect(explained.raw.split("\n")[0]).toContain("gemini does not trust this folder");
  });

  it("says nothing for ordinary failures", () => {
    expect(gateRemedy("TypeError: undefined is not a function")).toBeUndefined();
  });
});

describe("auth vs crash", () => {
  it("reads the captured sign-in wordings as auth", () => {
    for (const agent of ["claude", "codex", "gemini"]) {
      expect(classifyFailure(fixture(agent, "auth.txt"))).toBe("auth");
    }
  });

  it("reads a model error as a crash, not a login problem", () => {
    expect(classifyFailure(fixture("gemini", "crash.txt"))).toBe("crash");
    expect(classifyFailure(fixture("claude", "crash.txt"))).toBe("crash");
  });
});
