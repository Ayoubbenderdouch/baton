import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { detectAll } from "./registry.js";
import { classifyProbe, looksLikeAuthProblem } from "./shared.js";
import { codexSpec } from "./codex/spec.js";
import { geminiSpec } from "./gemini/spec.js";

const isWindows = process.platform === "win32";
const shimDir = mkdtempSync(path.join(tmpdir(), "baton-shims-"));
const originalPath = process.env.PATH;

/** Fake provider CLIs — CI never installs the real ones (docs/TESTING.md). */
function writeShim(name: string, versionOutput: string, exitCode = 0): void {
  if (isWindows) {
    writeFileSync(
      path.join(shimDir, `${name}.cmd`),
      `@echo off\r\necho ${versionOutput}\r\nexit /b ${exitCode}\r\n`,
      "utf8",
    );
    return;
  }
  const file = path.join(shimDir, name);
  writeFileSync(file, `#!/bin/sh\necho "${versionOutput}"\nexit ${exitCode}\n`, "utf8");
  chmodSync(file, 0o755);
}

mkdirSync(shimDir, { recursive: true });
writeShim("claude", "2.1.241 (Claude Code)");
writeShim("codex", "codex-cli 0.147.0");
writeShim("gemini", "0.56.0");



afterEach(() => {
  process.env.PATH = originalPath;
});

afterAll(() => {
  process.env.PATH = originalPath;
  rmSync(shimDir, { recursive: true, force: true });
});

describe("detection against fake shims", () => {
  it("reports every agent as ready with its parsed version", async () => {
    process.env.PATH = shimDir;
    const results = await detectAll();
    expect(results.map((r) => r.id)).toEqual(["claude", "codex", "gemini"]);
    expect(results.every((r) => r.installed)).toBe(true);
    expect(results.every((r) => r.verdict === "ready")).toBe(true);
    expect(results.map((r) => r.version)).toEqual(["2.1.241", "0.147.0", "0.56.0"]);
    // Detection must never claim to know the auth state without probing.
    expect(results.every((r) => r.auth === "not_probed")).toBe(true);
  });

  it("reports not_installed with the provider's own install command", async () => {
    process.env.PATH = path.join(shimDir, "empty");
    const results = await detectAll();
    expect(results.every((r) => r.verdict === "not_installed")).toBe(true);
    expect(results.map((r) => r.remedy)).toEqual([
      "npm i -g @anthropic-ai/claude-code",
      "npm i -g @openai/codex",
      "npm i -g @google/gemini-cli",
    ]);
  });
});

describe("auth pattern matching", () => {
  it("recognises how the CLIs word a missing login", () => {
    for (const line of [
      "Error: You are not logged in. Please log in to continue.",
      "error: not signed in — run `codex login`",
      "Authentication required",
      "HTTP 401 Unauthorized",
      "Your session expired, sign in again",
    ]) {
      expect(looksLikeAuthProblem(line)).toBe(true);
    }
  });

  it("does not fire on ordinary assistant prose", () => {
    for (const line of [
      "I updated the login form component and its tests.",
      "The auth middleware now returns 403 for expired roles.",
      "Added a signed-in state to the header.",
    ]) {
      expect(looksLikeAuthProblem(line)).toBe(false);
    }
  });
});

describe("the auth probe distinguishes a gate from a login problem", () => {
  const base = {
    id: "gemini" as const,
    installed: true,
    version: "0.56.0",
    auth: "not_probed" as const,
    verdict: "ready" as const,
  };

  it("explains a provider gate instead of reporting the verdict as unclear", () => {
    // The real refusal, byte for byte from fixtures/gemini/trust-error.txt.
    const output = readFileSync(
      path.join(process.cwd(), "fixtures", "gemini", "trust-error.txt"),
      "utf8",
    );
    const result = classifyProbe(geminiSpec, base, output, false, false);
    expect(result.verdict).toBe("ready");
    expect(result.auth).toBe("unknown");
    expect(result.detail).toContain("cannot verify from this folder");
    expect(result.detail).toContain("--skip-trust");
  });

  it("explains codex's git-repo gate the same way", () => {
    const output = readFileSync(
      path.join(process.cwd(), "fixtures", "codex", "git-repo-required.txt"),
      "utf8",
    );
    const result = classifyProbe(codexSpec, { ...base, id: "codex" }, output, false, false);
    expect(result.detail).toContain("--skip-git-repo-check");
  });

  it("still calls a real login failure a login failure", () => {
    const output = readFileSync(
      path.join(process.cwd(), "fixtures", "codex", "auth.txt"),
      "utf8",
    );
    const result = classifyProbe(codexSpec, { ...base, id: "codex" }, output, false, false);
    expect(result.verdict).toBe("auth");
    expect(result.remedy).toBe("codex login");
  });

  it("reports a successful probe as signed in", () => {
    expect(classifyProbe(geminiSpec, base, "", true, false).auth).toBe("ok");
  });

  it("says so when the probe simply timed out", () => {
    const result = classifyProbe(geminiSpec, base, "", false, true);
    expect(result.detail).toBe("auth probe timed out");
  });
});
