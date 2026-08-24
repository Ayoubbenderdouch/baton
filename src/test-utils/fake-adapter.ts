import { AsyncQueue } from "../core/async-queue.js";
import type {
  AgentAdapter,
  AgentEvent,
  AgentId,
  DetectResult,
  RunHandle,
  RunRequest,
} from "../core/types.js";

export interface FakeCall {
  request: RunRequest;
  /** Whatever the test wants to observe at the moment the agent was spawned. */
  snapshot?: unknown;
}

export interface FakeAdapterOptions {
  detect?: Partial<DetectResult>;
  /** Called when run() starts, so a test can inspect the world at spawn time. */
  onRun?: (request: RunRequest) => unknown;
}

export interface FakeAdapter extends AgentAdapter {
  calls: FakeCall[];
}

/** Replays scripted AgentEvents — the offline stand-in for a provider (docs/TESTING.md). */
export function createFakeAdapter(
  id: AgentId,
  scripts: AgentEvent[][],
  options: FakeAdapterOptions = {},
): FakeAdapter {
  const calls: FakeCall[] = [];
  let index = 0;

  return {
    id,
    displayName: `Fake ${id}`,
    calls,
    detect: async (): Promise<DetectResult> => ({
      id,
      installed: true,
      version: "0.0.0-fake",
      auth: "not_probed",
      verdict: "ready",
      ...options.detect,
    }),
    run(request: RunRequest): RunHandle {
      const snapshot = options.onRun?.(request);
      calls.push({ request, snapshot });
      const script = scripts[Math.min(index, scripts.length - 1)] ?? [];
      index += 1;
      const queue = new AsyncQueue<AgentEvent>();
      for (const event of script) queue.push(event);
      queue.close();
      return { events: queue, cancel: async () => undefined };
    },
  };
}

export const okScript = (text: string): AgentEvent[] => [
  { type: "start", sessionRef: "fake-session" },
  { type: "text", text },
  { type: "usage", inputTokens: 100, outputTokens: 20 },
  { type: "done", ok: true, resultText: text, sessionRef: "fake-session" },
];

export const limitScript = (raw: string, resetHint?: string): AgentEvent[] => [
  { type: "start" },
  { type: "text", text: "started working on it" },
  { type: "limit", raw, ...(resetHint !== undefined ? { resetHint } : {}) },
  { type: "done", ok: false, resultText: "started working on it" },
];

export const errorScript = (raw: string): AgentEvent[] => [
  { type: "start" },
  { type: "error", kind: "crash", raw },
  { type: "done", ok: false, resultText: "" },
];
