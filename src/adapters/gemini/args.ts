import type { RunRequest } from "../../core/types.js";
import type { Invocation } from "../invocation.js";
import { MAX_PROMPT_ARG_CHARS } from "../shared.js";

/**
 * Gemini ends turns by asking "does this plan sound good?" unless told otherwise, even
 * in auto modes (docs/ADAPTERS.md). This preamble is the counter-measure.
 */
export const GEMINI_NON_INTERACTIVE_PREAMBLE =
  "Non-interactive run. Never ask for confirmation; proceed and report what you did.";

/**
 * Verified against gemini 0.56.0 (docs/CLI-VERIFICATION.md):
 * `-p`, `-o text|json|stream-json`, `--approval-mode default|auto_edit|yolo|plan`.
 *
 * `auto` maps to `auto_edit`, NOT `yolo`: yolo auto-approves every tool call, which is
 * exactly the "yolo-class" mode the project reserves for Baton's explicit `--unsafe`.
 */
export function approvalModeFor(request: RunRequest): string {
  if (request.unsafe === true) return "yolo";
  return request.permissionLevel === "auto" ? "auto_edit" : "plan";
}

export function buildGeminiPrompt(prompt: string): string {
  return `${GEMINI_NON_INTERACTIVE_PREAMBLE}\n\n${prompt}`;
}

export function buildGeminiInvocation(request: RunRequest): Invocation {
  const args = ["-o", "stream-json", "--approval-mode", approvalModeFor(request)];
  args.push(...(request.extraArgs ?? []));
  const prompt = buildGeminiPrompt(request.prompt);
  if (prompt.length > MAX_PROMPT_ARG_CHARS) {
    // gemini appends `-p` to whatever arrives on stdin, so an empty -p plus stdin works.
    args.push("-p", "");
    return { args, input: prompt };
  }
  args.push("-p", prompt);
  return { args };
}
