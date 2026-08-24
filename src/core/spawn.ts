import { execa } from "execa";

export interface RunOnceOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Extra input on stdin (used by adapters that prefer stdin over argv). */
  input?: string;
}

export interface RunOnceResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
  /** ENOENT — the binary is not on PATH. */
  notInstalled: boolean;
  timedOut: boolean;
  errorMessage?: string;
}

/**
 * Run a provider CLI once and collect its output.
 *
 * Always `(binary, argsArray)` — never a shell string, never `shell: true`
 * (cross-platform-safety skill). The parent environment is passed through untouched:
 * the provider CLIs need their own variables, and Baton adds nothing auth-related.
 */
export async function runOnce(
  bin: string,
  args: string[],
  options: RunOnceOptions = {},
): Promise<RunOnceResult> {
  try {
    const result = await execa(bin, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      // why: provider CLIs read piped stdin when it is not a TTY (codex says "Reading
      // additional input from stdin..." and waits) — always hand them a closed stream.
      input: options.input ?? "",
      reject: false,
      all: false,
      stripFinalNewline: false,
      encoding: "utf8",
      windowsHide: true,
    });
    const code = (result as { code?: string }).code;
    return {
      ok: result.exitCode === 0 && !result.failed,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "",
      exitCode: result.exitCode,
      notInstalled: code === "ENOENT",
      timedOut: Boolean(result.timedOut),
      errorMessage: result.failed ? result.shortMessage : undefined,
    };
  } catch (error: unknown) {
    // why: reject:false covers non-zero exits, but a malformed spawn still throws.
    const err = error as { code?: string; shortMessage?: string; message?: string };
    return {
      ok: false,
      stdout: "",
      stderr: "",
      exitCode: undefined,
      notInstalled: err.code === "ENOENT",
      timedOut: false,
      errorMessage: err.shortMessage ?? err.message ?? String(error),
    };
  }
}

/** First semver-looking token of a `--version` output ("codex-cli 0.147.0" -> "0.147.0"). */
export function parseVersion(output: string): string | undefined {
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(output);
  return match?.[1];
}

export interface StreamingProcess {
  pid: number | undefined;
  stdout: AsyncIterable<Uint8Array>;
  stderr: AsyncIterable<Uint8Array>;
  /** Resolves with the exit code once the process is gone (never rejects). */
  done: Promise<{ exitCode: number | undefined; timedOut: boolean; failed: boolean }>;
  kill(): Promise<void>;
}

export interface SpawnStreamingOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Prompt payload for CLIs fed through stdin instead of argv. */
  input?: string;
}

/**
 * Spawn a provider CLI and stream both pipes.
 *
 * POSIX children are detached so they get their own process group and `kill()` can take
 * down the whole tree (agent CLIs spawn shells, which spawn compilers). Because a
 * detached child no longer receives the terminal's Ctrl+C, Baton forwards cancellation
 * itself — that is what keeps zero orphans on both platforms.
 */
export function spawnStreaming(
  bin: string,
  args: string[],
  options: SpawnStreamingOptions = {},
): StreamingProcess {
  const isWindows = process.platform === "win32";
  const child = execa(bin, args, {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    reject: false,
    detached: !isWindows,
    buffer: false,
    input: options.input ?? "",
    encoding: "buffer",
    windowsHide: true,
  });

  const done = child.then(
    (result) => ({
      exitCode: result.exitCode,
      timedOut: Boolean(result.timedOut),
      failed: Boolean(result.failed),
    }),
    () => ({ exitCode: undefined, timedOut: false, failed: true }),
  );

  return {
    pid: child.pid,
    stdout: child.stdout as unknown as AsyncIterable<Uint8Array>,
    stderr: child.stderr as unknown as AsyncIterable<Uint8Array>,
    done,
    kill: async () => {
      await killTree(child.pid, () => child.kill("SIGKILL"));
    },
  };
}

/** Kill a child and everything it started, on either platform. */
export async function killTree(
  pid: number | undefined,
  fallbackKill: () => void,
): Promise<void> {
  if (pid === undefined) {
    fallbackKill();
    return;
  }
  if (process.platform === "win32") {
    await execa("taskkill", ["/pid", String(pid), "/T", "/F"], {
      reject: false,
      windowsHide: true,
    });
    return;
  }
  try {
    // Negative pid = the whole process group (the child was spawned detached).
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // why: already gone — nothing left to kill.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    fallbackKill();
  }
}
