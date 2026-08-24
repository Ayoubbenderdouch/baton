import { AsyncQueue } from "../core/async-queue.js";
import type {
  AgentAdapter,
  AgentEvent,
  AgentId,
  DetectResult,
  RunHandle,
  RunRequest,
} from "../core/types.js";

/**
 * Test-only adapters (`BATON_TEST_FAKE=1`).
 *
 * The pack-smoke job installs the published tarball on a clean machine and must prove
 * that `baton run` works end to end — without a provider CLI, an account, or a network.
 * This is that stand-in; it is never reachable unless the env var is set.
 */
export function fakeModeEnabled(): boolean {
  return process.env.BATON_TEST_FAKE === "1";
}

export function createBuiltInFakeAdapter(id: AgentId): AgentAdapter {
  return {
    id,
    displayName: `${id} (fake)`,
    detect: async (): Promise<DetectResult> => ({
      id,
      installed: true,
      version: "0.0.0-fake",
      auth: "not_probed",
      verdict: "ready",
      detail: "BATON_TEST_FAKE=1",
    }),
    run(request: RunRequest): RunHandle {
      const queue = new AsyncQueue<AgentEvent>();
      const text = `fake ${id} handled: ${request.prompt.slice(0, 60)}`;
      queue.push({ type: "start", sessionRef: `fake-${id}` });
      queue.push({ type: "text", text });
      queue.push({ type: "usage", inputTokens: 1, outputTokens: 1 });
      queue.push({ type: "done", ok: true, resultText: text, sessionRef: `fake-${id}` });
      queue.close();
      return { events: queue, cancel: async () => undefined };
    },
  };
}
