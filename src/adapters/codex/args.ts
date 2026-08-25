import type { RunRequest } from "../../core/types.js";
import type { Invocation } from "../invocation.js";
import { MAX_PROMPT_ARG_CHARS } from "../shared.js";

/**
 * Verified against codex-cli 0.147.0 (docs/CLI-VERIFICATION.md):
 * `codex exec --json`, `-s/--sandbox read-only|workspace-write|danger-full-access`,
 * `--dangerously-bypass-approvals-and-sandbox`, `codex exec resume [SESSION_ID] [PROMPT]`.
 * `--full-auto` does not exist on `exec` in this version.
 */
/** Only the two sandboxed levels live here — `--unsafe` takes the bypass flag instead. */
export function sandboxFor(request: RunRequest): string {
  return request.permissionLevel === "auto" ? "workspace-write" : "read-only";
}

function withPrompt(args: string[], prompt: string): Invocation {
  if (prompt.length > MAX_PROMPT_ARG_CHARS) {
    // `-` tells codex to read the instructions from stdin.
    args.push("-");
    return { args, input: prompt };
  }
  args.push(prompt);
  return { args };
}

export function buildCodexInvocation(request: RunRequest): Invocation {
  const args = ["exec", "--json"];
  if (request.unsafe === true) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--sandbox", sandboxFor(request));
  }
  args.push(...(request.extraArgs ?? []));
  return withPrompt(args, request.prompt);
}

/**
 * `codex exec resume <thread_id> "<follow-up>"` keeps the provider-native context.
 *
 * `resume` does **not** accept `--sandbox` (verified against 0.147.0: zero hits in
 * `codex exec resume --help`, and passing it fails the run with "unexpected argument
 * '--sandbox' found"). The sandbox is set through a config override instead, which was
 * verified to be enforced, not merely accepted: a resumed read-only turn answers
 * "writing is blocked by read-only sandbox" and creates no file.
 */
export function buildCodexResumeInvocation(request: RunRequest & { sessionRef: string }): Invocation {
  const args = ["exec", "resume", request.sessionRef, "--json"];
  if (request.unsafe === true) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("-c", `sandbox_mode=${sandboxFor(request)}`);
  }
  args.push(...(request.extraArgs ?? []));
  return withPrompt(args, request.prompt);
}
