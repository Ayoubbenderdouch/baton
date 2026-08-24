import type {
  AgentAdapter,
  DetectOptions,
  DetectResult,
  RunHandle,
  RunRequest,
} from "../../core/types.js";
import { detectProvider, unimplementedRun } from "../shared.js";
import { codexSpec } from "./spec.js";

export class CodexAdapter implements AgentAdapter {
  readonly id = "codex" as const;
  readonly displayName = codexSpec.displayName;

  detect(options: DetectOptions = {}): Promise<DetectResult> {
    return detectProvider(codexSpec, options);
  }

  run(_request: RunRequest): RunHandle {
    return unimplementedRun(this.id);
  }
}
