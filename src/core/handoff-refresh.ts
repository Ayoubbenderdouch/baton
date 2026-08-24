import {
  appendToSummary,
  collectFilesTouched,
  deriveNextSteps,
  detectConstraintFiles,
  detectVerifyCommands,
  renderHandoff,
  writeHandoff,
  type HandoffPaths,
} from "./handoff.js";
import type { SessionStore } from "./session-store.js";

export interface RefreshOptions {
  maxRelays: number;
  now?: string;
}

/**
 * Rebuild HANDOFF.md from the session store plus live git state.
 * Called after every turn — not just on relays — so the briefing is always one file
 * away when a limit hits (handoff-protocol skill).
 */
export async function refreshHandoff(
  cwd: string,
  store: SessionStore,
  options: RefreshOptions,
): Promise<HandoffPaths> {
  const session = store.session;
  const last = store.lastTurn();
  const stoppedBy = last?.endedBy === "limit" ? "usage limit" : "completed turn";

  const content = renderHandoff({
    task: session.task,
    previousAgent: last?.agent,
    stoppedBy,
    relayCount: session.relayCount,
    maxRelays: options.maxRelays,
    summary: session.summary,
    filesTouched: await collectFilesTouched(cwd),
    nextSteps: deriveNextSteps(last?.endedBy, last?.resultSummary ?? ""),
    constraints: await detectConstraintFiles(cwd),
    verifyCommands: await detectVerifyCommands(cwd),
    now: options.now ?? new Date().toISOString(),
  });

  return writeHandoff(cwd, content);
}

/** Fold a finished turn's result into the rolling summary. */
export function recordTurnInSummary(store: SessionStore, resultSummary: string): void {
  store.setSummary(appendToSummary(store.session.summary, resultSummary));
}
