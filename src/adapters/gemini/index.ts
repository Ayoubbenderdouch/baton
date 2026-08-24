import type {
  AgentAdapter,
  DetectOptions,
  DetectResult,
  RunHandle,
  RunRequest,
} from "../../core/types.js";
import { detectProvider, runProvider } from "../shared.js";
import { buildGeminiInvocation } from "./args.js";
import { parseGeminiLine } from "./parse.js";
import { geminiSpec } from "./spec.js";

export class GeminiAdapter implements AgentAdapter {
  readonly id = "gemini" as const;
  readonly displayName = geminiSpec.displayName;

  detect(options: DetectOptions = {}): Promise<DetectResult> {
    return detectProvider(geminiSpec, options);
  }

  /**
   * Gemini is treated as stateless in v1: its `--resume` takes "latest" or an index,
   * not a session id, which is not a safe handle across projects. Continuity comes
   * from HANDOFF.md instead (docs/ADAPTERS.md).
   */
  run(request: RunRequest): RunHandle {
    return runProvider(
      {
        id: this.id,
        binName: geminiSpec.binName,
        installCommand: geminiSpec.installCommand,
        invocation: buildGeminiInvocation(request),
        parseLine: parseGeminiLine,
      },
      request,
    );
  }
}
