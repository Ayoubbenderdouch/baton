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
  const instance = render(React.createElement(App, { initialCwd: cwd }));
  await instance.waitUntilExit();
  return { started: true };
}
