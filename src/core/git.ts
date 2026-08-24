import { runOnce } from "./spawn.js";

/**
 * Which files a turn touched, measured the boring way: `git status --porcelain` before
 * and after. No git repo is a normal case, not an error.
 */
export type GitState = Map<string, string>;

const GIT_TIMEOUT_MS = 10_000;

export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await runOnce("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  return result.ok && result.stdout.trim() === "true";
}

export async function gitState(cwd: string): Promise<GitState | undefined> {
  const result = await runOnce("git", ["status", "--porcelain"], {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if (!result.ok) return undefined;
  const state: GitState = new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const status = line.slice(0, 2);
    const file = line.slice(3).trim();
    // Renames read as "old -> new"; the new path is the interesting one.
    const arrow = file.indexOf(" -> ");
    state.set(arrow === -1 ? file : file.slice(arrow + 4), status);
  }
  return state;
}

/** Files that appeared or changed status between two snapshots, sorted for determinism. */
export function changedBetween(before: GitState | undefined, after: GitState | undefined): string[] {
  if (after === undefined) return [];
  const changed: string[] = [];
  for (const [file, status] of after) {
    if (before === undefined || before.get(file) !== status) changed.push(file);
  }
  return changed.sort();
}

/** For HANDOFF.md: the working-tree picture as git itself prints it. */
export async function gitTouchedFiles(cwd: string): Promise<string[] | undefined> {
  const state = await gitState(cwd);
  if (state === undefined) return undefined;
  const tracked = await runOnce("git", ["diff", "--name-only"], {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  const files = new Set<string>(state.keys());
  if (tracked.ok) {
    for (const line of tracked.stdout.split(/\r?\n/)) {
      if (line.trim() !== "") files.add(line.trim());
    }
  }
  return [...files].sort();
}
