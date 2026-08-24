/** The contracts every part of Baton speaks (docs/ARCHITECTURE.md). */

export type AgentId = "claude" | "codex" | "gemini";

export const AGENT_IDS: readonly AgentId[] = ["claude", "codex", "gemini"] as const;

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}

/** How much freedom the provider CLI gets. `unsafe` is a separate, explicit opt-in. */
export type PermissionLevel = "safe" | "auto";

export type AuthState = "ok" | "signed_out" | "unknown" | "not_probed";

export type Verdict = "ready" | "not_installed" | "auth" | "error";

export interface DetectResult {
  id: AgentId;
  installed: boolean;
  binPath?: string;
  version?: string;
  auth: AuthState;
  verdict: Verdict;
  /** One short line of context for the table (never a stack trace). */
  detail?: string;
  /** The provider's own command that fixes this — never something Baton does itself. */
  remedy?: string;
}

export interface RunRequest {
  /** Final prompt including the handoff preamble when this is a relay. */
  prompt: string;
  cwd: string;
  permissionLevel: PermissionLevel;
  /** Provider-native session id to resume, when the adapter supports it. */
  sessionRef?: string;
  /** Reach for the provider's bypass mode. Only ever set by Baton's --unsafe flag. */
  unsafe?: boolean;
  /** Passthrough args from config (`agents.<id>.extraArgs`). */
  extraArgs?: string[];
  /** Abort the run from the outside. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** `--verbose`: every raw provider line, exactly as it arrived. */
  onRawLine?: (source: "stdout" | "stderr", line: string) => void;
}

export type AgentEvent =
  | { type: "start"; sessionRef?: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; detail?: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "limit"; raw: string; resetHint?: string }
  | { type: "error"; kind: "auth" | "not_installed" | "crash" | "unknown"; raw: string }
  | { type: "done"; ok: boolean; resultText: string; sessionRef?: string };

export interface RunHandle {
  events: AsyncIterable<AgentEvent>;
  /** Cross-platform tree kill. */
  cancel(): Promise<void>;
}

export interface DetectOptions {
  /** Probe sign-in with a 1-token prompt. Off by default — it costs quota. */
  probeAuth?: boolean;
  timeoutMs?: number;
}

export interface AgentAdapter {
  id: AgentId;
  displayName: string;
  detect(options?: DetectOptions): Promise<DetectResult>;
  run(req: RunRequest): RunHandle;
  buildResumeArgs?(sessionRef: string, prompt: string): string[];
}
