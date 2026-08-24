import { constants } from "node:fs";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** `~/.baton`, or `BATON_HOME` when set (tests always point this at a temp dir). */
export function batonHome(): string {
  const override = process.env.BATON_HOME;
  if (override && override.trim() !== "") return path.resolve(override);
  return path.join(os.homedir(), ".baton");
}

/** `<project>/.baton` — per-project session state. */
export function projectBatonDir(cwd: string): string {
  return path.join(cwd, ".baton");
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write via a temp file + rename so a crash never leaves half a config behind.
 * Windows cannot always rename over an existing file — unlink first, then retry.
 */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data, { encoding: "utf8" });
  try {
    await rename(tmp, file);
  } catch {
    try {
      await unlink(file);
    } catch {
      // why: the target may simply not exist — the rename below is the real check.
    }
    await rename(tmp, file);
  }
}

export async function readTextFile(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, { encoding: "utf8" });
  } catch {
    return undefined;
  }
}

/** Reads JSON, returning undefined for missing OR corrupt files — never throws. */
export async function readJsonFile<T>(file: string): Promise<T | undefined> {
  const raw = await readTextFile(file);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Keeps a corrupt file around as `.bak` instead of silently destroying evidence. */
export async function backupCorrupt(file: string): Promise<void> {
  if (!(await exists(file))) return;
  const raw = await readTextFile(file);
  if (raw === undefined) return;
  await writeFile(`${file}.bak`, raw, { encoding: "utf8" });
}
