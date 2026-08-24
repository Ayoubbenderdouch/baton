import type {
  AgentAdapter,
  DetectOptions,
  DetectResult,
  RunHandle,
  RunRequest,
} from "../../core/types.js";
import { detectProvider, runProvider } from "../shared.js";
import { buildCodexInvocation, buildCodexResumeInvocation } from "./args.js";
import { parseCodexLine } from "./parse.js";
import { codexSpec } from "./spec.js";

export class CodexAdapter implements AgentAdapter {
  readonly id = "codex" as const;
  readonly displayName = codexSpec.displayName;

  detect(options: DetectOptions = {}): Promise<DetectResult> {
    return detectProvider(codexSpec, options);
  }

  run(request: RunRequest): RunHandle {
    const invocation =
      request.sessionRef !== undefined && request.sessionRef !== ""
        ? buildCodexResumeInvocation({ ...request, sessionRef: request.sessionRef })
        : buildCodexInvocation(request);
    return runProvider(
      {
        id: this.id,
        binName: codexSpec.binName,
        installCommand: codexSpec.installCommand,
        invocation,
        parseLine: parseCodexLine,
      },
      request,
    );
  }

  buildResumeArgs(sessionRef: string, prompt: string): string[] {
    return buildCodexResumeInvocation({
      prompt,
      cwd: process.cwd(),
      permissionLevel: "auto",
      sessionRef,
    }).args;
  }
}
