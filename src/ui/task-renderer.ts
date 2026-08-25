import type { AgentEvent, AgentId } from "../core/types.js";

export interface RelayInfo {
  from: AgentId;
  to: AgentId;
  resetHint?: string;
  handoffPath: string;
}

/**
 * What the run pipeline needs from a view. The terminal renderer writes to stdout; the
 * interactive shell feeds the same calls into its React state. Neither the orchestrator
 * nor the failover engine knows which one it is talking to.
 */
export interface TaskRenderer {
  task(task: string): void;
  routerNote(note: string): void;
  agentStart(agent: AgentId): void;
  event(event: AgentEvent): void;
  raw(source: "stdout" | "stderr", line: string): void;
  relay(info: RelayInfo): void;
  agentDone(agent: AgentId, durationMs: number, filesChanged: number): void;
  note(text: string): void;
  warn(text: string): void;
  fail(what: string, remedy?: string, logPath?: string): void;
  stop(): void;
}
