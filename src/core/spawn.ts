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
