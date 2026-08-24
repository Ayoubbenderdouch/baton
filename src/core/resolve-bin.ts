import { accessSync, constants, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface ResolveBinOptions {
  /** Defaults to process.env.PATH. */
  path?: string;
  /** Defaults to process.env.PATHEXT (Windows only). */
  pathExt?: string;
  /** Defaults to process.platform — settable so Windows logic is testable anywhere. */
  platform?: NodeJS.Platform;
}

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.JS;.WSF;.PS1";

function isExecutableFile(file: string, isWindows: boolean): boolean {
  try {
    if (!statSync(file).isFile()) return false;
  } catch {
    return false;
  }
  // why: X_OK is meaningless on Windows — being a file with a PATHEXT extension is
  // what "executable" means there.
  if (isWindows) return true;
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Windows PATH entries are sometimes quoted: `"C:\Program Files\x"`. */
function cleanEntry(entry: string): string {
  const trimmed = entry.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function candidateNames(name: string, isWindows: boolean, pathExt: string): string[] {
  if (!isWindows) return [name];
  const extensions = pathExt
    .split(";")
    .map((ext) => ext.trim())
    .filter((ext) => ext.length > 0);
  const lower = name.toLowerCase();
  // Already carries one of the executable extensions -> use it as given.
  if (extensions.some((ext) => lower.endsWith(ext.toLowerCase()))) return [name];
  return extensions.map((ext) => `${name}${ext}`);
}

/**
 * Find the real invocable file for a command name, honoring PATHEXT on Windows where
 * globally installed npm CLIs are `.cmd`/`.ps1` shims rather than bare names.
 * Returns an absolute path, or undefined when the command is not installed.
 */
export function resolveBin(name: string, options: ResolveBinOptions = {}): string | undefined {
  if (name === "") return undefined;
  const platform = options.platform ?? process.platform;
  const isWindows = platform === "win32";
  const pathValue = options.path ?? process.env.PATH ?? "";
  const pathExt = options.pathExt ?? process.env.PATHEXT ?? DEFAULT_PATHEXT;
  const separator = isWindows ? ";" : ":";

  // An explicit path (absolute or relative) bypasses the PATH search entirely.
  if (name.includes("/") || (isWindows && name.includes("\\"))) {
    const resolved = path.resolve(name);
    for (const candidate of candidateNames(resolved, isWindows, pathExt)) {
      if (isExecutableFile(candidate, isWindows)) return candidate;
    }
    return undefined;
  }

  for (const rawEntry of pathValue.split(separator)) {
    const entry = cleanEntry(rawEntry);
    if (entry === "") continue;
    const candidates = candidateNames(name, isWindows, pathExt);

    if (!isWindows) {
      for (const candidate of candidates) {
        const full = path.join(entry, candidate);
        if (isExecutableFile(full, isWindows)) return full;
      }
      continue;
    }

    // Windows matches file names case-insensitively, so `claude.cmd` must be found for
    // the `.CMD` entry of PATHEXT — and the REAL on-disk name is what we hand to execa
    // (a fabricated casing would break on a case-sensitive filesystem).
    let entries: string[];
    try {
      entries = readdirSync(entry);
    } catch {
      continue;
    }
    const byLowerName = new Map<string, string>();
    for (const file of entries) {
      const key = file.toLowerCase();
      if (!byLowerName.has(key)) byLowerName.set(key, file);
    }
    for (const candidate of candidates) {
      const real = byLowerName.get(candidate.toLowerCase());
      if (real === undefined) continue;
      const full = path.join(entry, real);
      if (isExecutableFile(full, isWindows)) return full;
    }
  }
  return undefined;
}
