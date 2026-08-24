/**
 * Pack smoke test: build a tarball, install it into a clean temp project, then prove
 * `baton --version` and `baton doctor` work there — with fake provider shims on PATH,
 * never the real CLIs. Runs identically on macOS, Linux and Windows.
 */
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const isWindows = process.platform === "win32";
const repoRoot = resolve(import.meta.dirname, "..");

function npm(args, cwd) {
  const execPath = process.env.npm_execpath;
  const result =
    execPath && execPath.endsWith(".js")
      ? spawnSync(process.execPath, [execPath, ...args], { cwd, encoding: "utf8" })
      : spawnSync(isWindows ? "npm.cmd" : "npm", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function fail(message, extra = "") {
  process.stderr.write(`smoke: ${message}\n${extra}\n`);
  process.exit(1);
}

/** Fake `claude` / `codex` / `gemini` on PATH so doctor has something to detect. */
function writeShims(dir) {
  mkdirSync(dir, { recursive: true });
  for (const [name, version] of [
    ["claude", "9.9.9 (Claude Code)"],
    ["codex", "codex-cli 9.9.9"],
    ["gemini", "9.9.9"],
  ]) {
    if (isWindows) {
      writeFileSync(join(dir, `${name}.cmd`), `@echo off\r\necho ${version}\r\n`, "utf8");
    } else {
      const file = join(dir, name);
      writeFileSync(file, `#!/bin/sh\necho "${version}"\n`, "utf8");
      chmodSync(file, 0o755);
    }
  }
}

const workdir = mkdtempSync(join(tmpdir(), "baton-smoke-"));
try {
  process.stdout.write(`smoke: workdir ${workdir}\n`);

  // why: the prepack build prints to stdout too, so locate the tarball on disk
  // instead of parsing npm's mixed output.
  npm(["pack", "--pack-destination", workdir], repoRoot);
  const tarballName = readdirSync(workdir).find((f) => f.endsWith(".tgz"));
  if (!tarballName) fail(`no tarball produced in ${workdir}`);
  const tarball = join(workdir, tarballName);

  const project = join(workdir, "app");
  mkdirSync(project);
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ name: "baton-smoke", version: "1.0.0", private: true }, null, 2),
    "utf8",
  );
  npm(["install", "--no-audit", "--no-fund", tarball], project);

  const binShim = join(
    project,
    "node_modules",
    ".bin",
    isWindows ? "baton.cmd" : "baton",
  );
  if (!existsSync(binShim)) fail(`bin shim missing at ${binShim}`);

  const entry = join(project, "node_modules", "baton-ai", "dist", "index.js");
  if (!existsSync(entry)) fail(`installed entry missing at ${entry}`);

  const version = spawnSync(process.execPath, [entry, "--version"], { encoding: "utf8" });
  if (version.status !== 0 || !/^\d+\.\d+\.\d+/.test(version.stdout.trim())) {
    fail("baton --version did not print a version", `${version.stdout}${version.stderr}`);
  }
  process.stdout.write(`smoke: baton --version -> ${version.stdout.trim()}\n`);

  const shimDir = join(workdir, "shims");
  writeShims(shimDir);
  const doctor = spawnSync(process.execPath, [entry, "doctor"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${shimDir}${isWindows ? ";" : ":"}${process.env.PATH}`,
    },
  });
  if (doctor.status !== 0) {
    fail(
      "baton doctor exited non-zero with fake shims",
      `${doctor.stdout}${doctor.stderr}`,
    );
  }
  process.stdout.write(`smoke: baton doctor ok\n${doctor.stdout}`);

  // A real run through the whole pipeline, with fake adapters: no provider CLI, no
  // account, no network (docs/TESTING.md layer 3).
  const runHome = join(workdir, "home");
  const runProject = join(workdir, "project");
  mkdirSync(runProject, { recursive: true });
  const run = spawnSync(process.execPath, [entry, "run", "smoke task", "--quiet"], {
    cwd: runProject,
    encoding: "utf8",
    env: { ...process.env, BATON_TEST_FAKE: "1", BATON_HOME: runHome },
  });
  if (run.status !== 0 || !run.stdout.includes("done")) {
    fail("baton run with BATON_TEST_FAKE=1 did not finish", `${run.stdout}${run.stderr}`);
  }
  if (!existsSync(join(runProject, "HANDOFF.md"))) {
    fail("baton run did not write HANDOFF.md");
  }
  process.stdout.write(`smoke: baton run ok\n${run.stdout}`);
  process.stdout.write("smoke: PASS\n");
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
