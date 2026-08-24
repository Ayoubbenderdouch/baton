import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { detectAll } from "./registry.js";
import { looksLikeAuthProblem } from "./shared.js";

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


/** A shim that answers `--version` but fails the actual probe run, like a real gate. */
function writeGatedShim(name: string, version: string, failure: string, code: number): void {
  if (isWindows) {
    writeFileSync(
      path.join(shimDir, `${name}.cmd`),
      `@echo off\r\nif "%1"=="--version" (echo ${version} & exit /b 0)\r\necho ${failure} 1>&2\r\nexit /b ${code}\r\n`,
      "utf8",
    );
    return;
  }
  const file = path.join(shimDir, name);
  writeFileSync(
    file,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\necho "${failure}" 1>&2\nexit ${code}\n`,
    "utf8",
  );
  chmodSync(file, 0o755);
}

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
  it("explains a provider gate instead of reporting the verdict as unclear", async () => {
    const { detectProvider } = await import("./shared.js");
    const { geminiSpec } = await import("./gemini/spec.js");
    process.env.PATH = shimDir;
    // Refuses the way gemini refuses an untrusted folder (exit 55) but still answers
    // --version, exactly like the real binary does.
    writeGatedShim("gemini", "0.56.0", "Gemini CLI is not running in a trusted directory", 55);
    const result = await detectProvider(geminiSpec, { probeAuth: true });
    expect(result.verdict).toBe("ready");
    expect(result.auth).toBe("unknown");
    expect(result.detail).toContain("cannot verify from this folder");
    expect(result.detail).toContain("--skip-trust");
    writeShim("gemini", "0.56.0");
  });

  it("still calls a real login failure a login failure", async () => {
    const { detectProvider } = await import("./shared.js");
    const { codexSpec } = await import("./codex/spec.js");
    process.env.PATH = shimDir;
    writeGatedShim("codex", "codex-cli 0.147.0", "Not logged in. Please log in and retry.", 1);
    const result = await detectProvider(codexSpec, { probeAuth: true });
    expect(result.verdict).toBe("auth");
    expect(result.remedy).toBe("codex login");
    writeShim("codex", "codex-cli 0.147.0");
  });
});
