import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveBin } from "./resolve-bin.js";

const root = mkdtempSync(path.join(tmpdir(), "baton-resolvebin-"));
const winDir = path.join(root, "win");
const posixDir = path.join(root, "posix");
mkdirSync(winDir, { recursive: true });
mkdirSync(posixDir, { recursive: true });

// Fake global-npm shims exactly as Windows installs them.
writeFileSync(path.join(winDir, "claude.cmd"), "@echo off\r\necho 9.9.9\r\n", "utf8");
writeFileSync(path.join(winDir, "codex.CMD"), "@echo off\r\necho 9.9.9\r\n", "utf8");
writeFileSync(path.join(winDir, "gemini.ps1"), "echo 9.9.9\r\n", "utf8");
writeFileSync(path.join(winDir, "gemini"), "#!/bin/sh\necho 9.9.9\n", "utf8");

const posixBin = path.join(posixDir, "claude");
writeFileSync(posixBin, "#!/bin/sh\necho 9.9.9\n", "utf8");
chmodSync(posixBin, 0o755);
const notExecutable = path.join(posixDir, "codex");
writeFileSync(notExecutable, "#!/bin/sh\necho nope\n", "utf8");
chmodSync(notExecutable, 0o644);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("resolveBin on Windows semantics", () => {
  const win = {
    platform: "win32" as NodeJS.Platform,
    path: `${winDir};C:\\does\\not\\exist`,
    pathExt: ".COM;.EXE;.BAT;.CMD;.VBS;.JS;.WSF;.PS1",
  };

  it("finds a .cmd shim for a bare name", () => {
    expect(resolveBin("claude", win)).toBe(path.join(winDir, "claude.cmd"));
  });

  it("matches PATHEXT case-insensitively", () => {
    expect(resolveBin("codex", win)).toBe(path.join(winDir, "codex.CMD"));
  });

  it("prefers earlier PATHEXT entries over later ones", () => {
    // gemini exists as an extensionless file and as .ps1 — PATHEXT decides on Windows.
    expect(resolveBin("gemini", win)).toBe(path.join(winDir, "gemini.ps1"));
  });

  it("returns undefined for a command that is not installed", () => {
    expect(resolveBin("kimi", win)).toBeUndefined();
  });

  it("tolerates quoted PATH entries", () => {
    expect(resolveBin("claude", { ...win, path: `"${winDir}"` })).toBe(
      path.join(winDir, "claude.cmd"),
    );
  });

  it("uses a name that already has an executable extension as-is", () => {
    expect(resolveBin("claude.cmd", win)).toBe(path.join(winDir, "claude.cmd"));
  });
});

describe("resolveBin on POSIX semantics", () => {
  const posix = {
    platform: "darwin" as NodeJS.Platform,
    path: `${posixDir}:/does/not/exist`,
  };

  it("finds an executable file", () => {
    expect(resolveBin("claude", posix)).toBe(posixBin);
  });

  it("ignores a file without the executable bit", () => {
    expect(resolveBin("codex", posix)).toBeUndefined();
  });

  it("ignores directories", () => {
    expect(resolveBin("win", { platform: "darwin", path: root })).toBeUndefined();
  });

  it("resolves an explicit path without searching PATH", () => {
    expect(resolveBin(posixBin, { platform: "darwin", path: "" })).toBe(posixBin);
  });

  it("returns undefined for an empty name", () => {
    expect(resolveBin("", posix)).toBeUndefined();
  });
});
