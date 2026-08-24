import path from "node:path";
import type { AgentId } from "./types.js";
import { projectBatonDir, readJsonFile, writeFileAtomic, exists } from "./paths.js";
import { gitTouchedFiles } from "./git.js";

/**
 * The exact preamble a relaying agent receives (docs/FAILOVER.md §3).
 * Changing this wording is a breaking change and needs a CHANGELOG entry — the
 * handoff-protocol skill and a test both guard it.
 */
export const RELAY_PREAMBLE = `You are taking over an in-progress coding task from another AI agent that hit its
usage limit. Read the file HANDOFF.md in the project root first, then continue the
task from where it stopped. Do not restart completed work. Do not ask for
confirmation; this is a non-interactive run — proceed and report what you did.`;

export const HANDOFF_FILENAME = "HANDOFF.md";
const MAX_WORDS = 800;

export interface HandoffInput {
  task: string;
  previousAgent: AgentId | undefined;
  stoppedBy: "usage limit" | "completed turn";
  relayCount: number;
  maxRelays: number;
  /** Rolling summary bullets from the SessionStore. */
  summary: string;
  /** undefined = not a git repo. */
  filesTouched: string[] | undefined;
  nextSteps: string;
  constraints: string[];
  verifyCommands: string[];
  now: string;
}

function bullets(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => (line.startsWith("- ") ? line : `- ${line}`));
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length;
}

/**
 * Render HANDOFF.md exactly as docs/FAILOVER.md §4 specifies.
 * Deterministic: same store + same git state -> byte-identical output, apart from the
 * single timestamp in the header.
 */
export function renderHandoff(input: HandoffInput): string {
  const done = bullets(input.summary);
  const files = input.filesTouched;

  const build = (doneLines: string[]): string =>
    [
      `# HANDOFF — ${input.now}`,
      "",
      "## Task",
      input.task.trim() === "" ? "(no task recorded)" : input.task.trim(),
      "",
      "## Status",
      `- Previous agent: ${input.previousAgent ?? "none"} (stopped: ${input.stoppedBy})`,
      `- Relay count for this task: ${input.relayCount}/${input.maxRelays}`,
      "",
      "## Done so far",
      ...(doneLines.length > 0 ? doneLines : ["- (nothing recorded yet)"]),
      "",
      "## Files touched (git)",
      ...(files === undefined
        ? ["(not a git repo)"]
        : files.length > 0
          ? files.map((file) => `- ${file}`)
          : ["(no files changed yet)"]),
      "",
      "## In progress / next steps",
      input.nextSteps.trim() === "" ? "- Continue the task above." : input.nextSteps.trim(),
      "",
      "## Constraints & decisions already made",
      ...(input.constraints.length > 0
        ? input.constraints.map((line) => `- ${line}`)
        : ["- (none recorded)"]),
      "",
      "## How to verify",
      ...(input.verifyCommands.length > 0
        ? input.verifyCommands.map((command) => `- \`${command}\``)
        : ["- (no verification command detected)"]),
      "",
    ].join("\n");

  // A briefing, not a transcript: compress "Done so far", never the next steps.
  const kept = [...done];
  let compressed = 0;
  const withDigest = (): string[] =>
    compressed > 0 ? [`- earlier: ${compressed} steps compressed`, ...kept] : kept;

  let text = build(withDigest());
  while (countWords(text) > MAX_WORDS && kept.length > 0) {
    kept.shift();
    compressed += 1;
    text = build(withDigest());
  }
  return text;
}

export const SUMMARY_MAX_CHARS = 2500;

/**
 * Rolling summary maintenance: append the turn's result, and when the summary grows
 * past the limit fold the oldest entries into one digest line. Pure string logic — no
 * LLM is involved, because the account that would run it may be exactly the one that
 * just hit its limit.
 */
export function appendToSummary(
  summary: string,
  entry: string,
  maxChars: number = SUMMARY_MAX_CHARS,
): string {
  const clean = entry.replace(/\s+/g, " ").trim();
  let lines = bullets(summary);

  // A digest line already at the top carries the count of everything folded so far.
  let compressed = 0;
  const firstLine = lines[0];
  if (firstLine?.startsWith("- earlier: ")) {
    const previous = Number.parseInt(firstLine.replace(/\D+/g, ""), 10);
    compressed = Number.isNaN(previous) ? 0 : previous;
    lines = lines.slice(1);
  }
  if (clean !== "") lines.push(`- ${clean}`);

  const withDigest = (): string[] =>
    compressed > 0 ? [`- earlier: ${compressed} steps compressed`, ...lines] : lines;

  while (withDigest().join("\n").length > maxChars && lines.length > 1) {
    lines.shift();
    compressed += 1;
  }
  return withDigest().join("\n");
}

interface PackageJson {
  scripts?: Record<string, string>;
}

/** The commands a fresh agent should run to know it did not break anything. */
export async function detectVerifyCommands(cwd: string): Promise<string[]> {
  const pkg = await readJsonFile<PackageJson>(path.join(cwd, "package.json"));
  const scripts = pkg?.scripts ?? {};
  const commands: string[] = [];
  for (const name of ["test", "lint", "typecheck", "build"]) {
    if (typeof scripts[name] !== "string") continue;
    // `npm test` is the idiomatic form; everything else needs `run`.
    commands.push(name === "test" ? "npm test" : `npm run ${name}`);
  }
  if (commands.length > 0) return commands;
  if (await exists(path.join(cwd, "Cargo.toml"))) return ["cargo test"];
  if (await exists(path.join(cwd, "pyproject.toml"))) return ["pytest"];
  if (await exists(path.join(cwd, "go.mod"))) return ["go test ./..."];
  return [];
}

/** Project conventions a relaying agent must read instead of re-deciding. */
export async function detectConstraintFiles(cwd: string): Promise<string[]> {
  const found: string[] = [];
  for (const file of ["CLAUDE.md", "AGENTS.md", "GEMINI.md", "CONTRIBUTING.md"]) {
    if (await exists(path.join(cwd, file))) {
      found.push(`Project conventions are written in ${file} — follow them, do not re-litigate.`);
    }
  }
  return found;
}

export interface HandoffPaths {
  rootPath: string;
  mirrorPath: string;
}

/** Written at the project root (agents read files there) and mirrored into .baton/. */
export async function writeHandoff(cwd: string, content: string): Promise<HandoffPaths> {
  const rootPath = path.join(cwd, HANDOFF_FILENAME);
  const mirrorPath = path.join(projectBatonDir(cwd), HANDOFF_FILENAME);
  // Normalized \n line endings keep the file git-friendly on every platform.
  const normalized = content.replace(/\r\n/g, "\n");
  await writeFileAtomic(rootPath, normalized);
  await writeFileAtomic(mirrorPath, normalized);
  return { rootPath, mirrorPath };
}

export async function collectFilesTouched(cwd: string): Promise<string[] | undefined> {
  return gitTouchedFiles(cwd);
}

/** What the previous agent was doing when it stopped — derived, never invented. */
export function deriveNextSteps(
  endedBy: "done" | "limit" | "error" | "cancel" | undefined,
  lastResult: string,
): string {
  const lines: string[] = [];
  switch (endedBy) {
    case "limit":
      lines.push("- The previous agent stopped mid-task when its usage limit hit.");
      break;
    case "error":
      lines.push("- The previous agent stopped on an error; check the state before continuing.");
      break;
    case "cancel":
      lines.push("- The previous run was cancelled by the user mid-task.");
      break;
    case "done":
      lines.push("- The previous turn finished normally.");
      break;
    default:
      lines.push("- Nothing has run yet for this task.");
      return lines.join("\n");
  }
  if (lastResult.trim() !== "") lines.push(`- Its last reported state: ${lastResult.trim()}`);
  lines.push("- Continue the task above from there. Do not restart finished work.");
  return lines.join("\n");
}
