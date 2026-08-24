import type { RunRequest } from "../../core/types.js";
import { MAX_PROMPT_ARG_CHARS } from "../shared.js";
import type { Invocation } from "../invocation.js";

/** Read-only work: enough to inspect a repo, nothing that changes it. */
export const SAFE_TOOLS = "Read,Grep,Glob,Bash(git diff:*),Bash(git status:*),Bash(git log:*)";

/**
 * Auto mode: edits are accepted, but shell access stays scoped to the commands a
 * coding task actually needs. Anything else is the user's call via
 * `agents.claude.extraArgs` — Baton does not hand out a blank shell by default.
 */
export const AUTO_TOOLS =
  "Read,Grep,Glob,Edit,Write,NotebookEdit,TodoWrite," +
  "Bash(git:*),Bash(npm:*),Bash(pnpm:*),Bash(yarn:*),Bash(node:*)," +
  "Bash(python:*),Bash(python3:*),Bash(pytest:*),Bash(cargo:*),Bash(go:*)";

/**
 * Verified against claude 2.1.241 (docs/CLI-VERIFICATION.md):
 * `-p`, `--output-format stream-json` (requires `--verbose`), `--permission-mode`,
 * `--allowedTools`, `--resume`. `--max-turns` no longer exists and is not passed.
 */
export function buildClaudeInvocation(request: RunRequest): Invocation {
  const args = ["--output-format", "stream-json", "--verbose"];

  if (request.unsafe === true) {
    // Only reachable through Baton's explicit --unsafe flag, with a red warning.
    args.push("--dangerously-skip-permissions");
  } else if (request.permissionLevel === "auto") {
    args.push("--permission-mode", "acceptEdits", "--allowedTools", AUTO_TOOLS);
  } else {
    args.push("--allowedTools", SAFE_TOOLS);
  }

  if (request.sessionRef !== undefined && request.sessionRef !== "") {
    args.push("--resume", request.sessionRef);
  }

  args.push(...(request.extraArgs ?? []));

  if (request.prompt.length > MAX_PROMPT_ARG_CHARS) {
    args.push("-p");
    return { args, input: request.prompt };
  }
  args.push("-p", request.prompt);
  return { args };
}

/** Same shape for `baton continue` on the same agent (native resume). */
export function buildClaudeResumeArgs(sessionRef: string, prompt: string): string[] {
  return buildClaudeInvocation({
    prompt,
    cwd: process.cwd(),
    permissionLevel: "auto",
    sessionRef,
  }).args;
}
