import type {
  AgentAdapter,
  DetectOptions,
  DetectResult,
  RunHandle,
  RunRequest,
} from "../../core/types.js";
import { detectProvider, unimplementedRun } from "../shared.js";
import { geminiSpec } from "./spec.js";

export class GeminiAdapter implements AgentAdapter {
  readonly id = "gemini" as const;
  readonly displayName = geminiSpec.displayName;

  detect(options: DetectOptions = {}): Promise<DetectResult> {
    return detectProvider(geminiSpec, options);
  }

  run(_request: RunRequest): RunHandle {
    return unimplementedRun(this.id);
  }
}
