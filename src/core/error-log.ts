import path from "node:path";
import { batonHome, ensureDir, writeFileAtomic } from "./paths.js";

export function lastErrorLogPath(): string {
  return path.join(batonHome(), "last-error.log");
}

/**
 * Users get three lines; the full detail goes here (docs/UX-SPEC.md).
 * Writing the log must never be the reason a command fails, so every failure to write
 * is swallowed.
 */
export async function writeLastError(error: unknown, context: string): Promise<string> {
  const file = lastErrorLogPath();
  const stamp = new Date().toISOString();
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? "(no stack)"}`
      : String(error);
  try {
    await ensureDir(path.dirname(file));
    await writeFileAtomic(file, `[${stamp}] ${context}\n${detail}\n`);
  } catch {
    // why: if we cannot write the log, the message on screen is still the priority.
  }
  return file;
}
