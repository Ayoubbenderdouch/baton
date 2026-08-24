import type {
  AgentAdapter,
  DetectOptions,
  DetectResult,
  RunHandle,
  RunRequest,
} from "../../core/types.js";
import { detectProvider, unimplementedRun } from "../shared.js";
import { claudeSpec } from "./spec.js";

export class ClaudeAdapter implements AgentAdapter {
  readonly id = "claude" as const;
  readonly displayName = claudeSpec.displayName;

  detect(options: DetectOptions = {}): Promise<DetectResult> {
    return detectProvider(claudeSpec, options);
  }

  run(_request: RunRequest): RunHandle {
    return unimplementedRun(this.id);
  }
}
