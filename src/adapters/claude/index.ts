import type {
  AgentAdapter,
  DetectOptions,
  DetectResult,
  RunHandle,
  RunRequest,
} from "../../core/types.js";
import { detectProvider, runProvider } from "../shared.js";
import { buildClaudeInvocation, buildClaudeResumeArgs } from "./args.js";
import { parseClaudeLine } from "./parse.js";
import { claudeSpec } from "./spec.js";

export class ClaudeAdapter implements AgentAdapter {
  readonly id = "claude" as const;
  readonly displayName = claudeSpec.displayName;

  detect(options: DetectOptions = {}): Promise<DetectResult> {
    return detectProvider(claudeSpec, options);
  }

  run(request: RunRequest): RunHandle {
    return runProvider(
      {
        id: this.id,
        binName: claudeSpec.binName,
        installCommand: claudeSpec.installCommand,
        invocation: buildClaudeInvocation(request),
        parseLine: parseClaudeLine,
      },
      request,
    );
  }

  buildResumeArgs(sessionRef: string, prompt: string): string[] {
    return buildClaudeResumeArgs(sessionRef, prompt);
  }
}
