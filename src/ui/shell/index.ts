import { VERSION } from "../../cli/program.js";
import { isTTY } from "../theme.js";

export interface ShellResult {
  started: boolean;
  reason?: string;
}

/**
 * `baton` with no task opens the interactive shell (docs/UX-SPEC.md, M8).
 *
 * Ink and React are loaded here and nowhere else, so `baton run "task"` — the path
 * almost every invocation takes — never pays for a React runtime it does not use.
 */
export async function startShell(cwd: string = process.cwd()): Promise<ShellResult> {
  if (!isTTY()) {
    return { started: false, reason: "not a terminal" };
  }
  const [{ render }, React, { App }] = await Promise.all([
    import("ink"),
    import("react"),
    import("./app.js"),
  ]);
  const { spawnInteractive } = await import("../../core/spawn.js");
  const { resolveBin } = await import("../../core/resolve-bin.js");
  const { paint } = await import("../theme.js");

  /**
   * Hand the terminal over to a provider's own auth flow: clear the frame, leave raw
   * mode, let the child own stdio, then take everything back and redraw.
   */
  // Filled in once the app is rendered; suspend() only ever runs after that.
  const frame: { current?: { clear: () => void } } = {};

  const suspend = async (bin: string, args: string[], note?: string): Promise<number> => {
    const resolved = resolveBin(bin);
    if (resolved === undefined) return 127;
    frame.current?.clear();
    const wasRaw = process.stdin.isRaw === true;
    if (wasRaw && process.stdin.setRawMode !== undefined) process.stdin.setRawMode(false);
    process.stdout.write("\x1b[?25h");
    if (note !== undefined) process.stdout.write(`${paint.dim(note)}\n`);
    try {
      return await spawnInteractive(resolved, args, { cwd });
    } finally {
      if (wasRaw && process.stdin.setRawMode !== undefined) process.stdin.setRawMode(true);
    }
  };

  const instance = render(
    React.createElement(App, { initialCwd: cwd, version: VERSION, suspend }),
  );
  frame.current = instance;
  await instance.waitUntilExit();
  // Whatever happened in between, give the terminal back the way we found it.
  process.stdout.write("\x1b[?25h");
  return { started: true };
}
