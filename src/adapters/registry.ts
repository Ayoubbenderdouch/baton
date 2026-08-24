import type { AgentAdapter, AgentId, DetectOptions, DetectResult } from "../core/types.js";
import { AGENT_IDS } from "../core/types.js";
import { ClaudeAdapter } from "./claude/index.js";
import { CodexAdapter } from "./codex/index.js";
import { GeminiAdapter } from "./gemini/index.js";

const registry: Record<AgentId, AgentAdapter> = {
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
  gemini: new GeminiAdapter(),
};

export function getAdapter(id: AgentId): AgentAdapter {
  return registry[id];
}

export function allAdapters(): AgentAdapter[] {
  return AGENT_IDS.map((id) => registry[id]);
}

/** Detect every provider in parallel — the slowest CLI decides how long this takes. */
export async function detectAll(options: DetectOptions = {}): Promise<DetectResult[]> {
  return Promise.all(allAdapters().map((adapter) => adapter.detect(options)));
}
