import type { AgentId, DetectResult } from "../../core/types.js";

export type Screen = "welcome" | "menu" | "task" | "running" | "folder" | "status";

export interface AgentRow {
  id: AgentId;
  /** ● ready · ◌ cooling · ○ unavailable */
  mark: "ready" | "cooling" | "blocked";
  /** Short right-hand label: a version, or what is wrong. */
  label: string;
  /** The provider's own command that fixes it — Baton never runs a login itself. */
  remedy?: string;
}

export interface WelcomeSummary {
  rows: AgentRow[];
  readyCount: number;
  /** Enough to work with: at least one agent can run. */
  canContinue: boolean;
  headline: string;
}

/**
 * Turn detection results into what the welcome screen shows.
 *
 * Pure on purpose: the wizard's wording is the part users judge Baton by, so it is
 * tested directly instead of through a terminal.
 */
export function summarize(
  results: DetectResult[],
  cooling: (agent: AgentId) => string | undefined,
): WelcomeSummary {
  const rows: AgentRow[] = results.map((result) => {
    if (!result.installed) {
      return {
        id: result.id,
        mark: "blocked",
        label: "not installed",
        ...(result.remedy !== undefined ? { remedy: result.remedy } : {}),
      };
    }
    if (result.verdict === "auth" || result.auth === "signed_out") {
      return {
        id: result.id,
        mark: "blocked",
        label: "not signed in",
        ...(result.remedy !== undefined ? { remedy: result.remedy } : {}),
      };
    }
    const coolingHint = cooling(result.id);
    if (coolingHint !== undefined) {
      return { id: result.id, mark: "cooling", label: coolingHint };
    }
    const version = result.version ?? "unknown version";
    if (result.auth === "ok") return { id: result.id, mark: "ready", label: `signed in · ${version}` };
    return { id: result.id, mark: "ready", label: version };
  });

  const readyCount = rows.filter((row) => row.mark === "ready").length;
  return {
    rows,
    readyCount,
    canContinue: readyCount >= 1,
    headline: headlineFor(readyCount, rows.length),
  };
}

export function headlineFor(ready: number, total: number): string {
  if (ready === 0) return `no agent is ready — install or sign in to one of the ${total}`;
  if (ready === 1) return `1 of ${total} ready — enough to work, nothing to relay to yet`;
  return `${ready} of ${total} ready — baton can relay between them`;
}

export interface MenuItem {
  key: Screen | "quit";
  label: string;
  hint: string;
}

export const MENU: MenuItem[] = [
  { key: "task", label: "Run a task", hint: "route it, stream it, relay on a limit" },
  { key: "folder", label: "Choose project folder", hint: "where the agents will work" },
  { key: "status", label: "Show status", hint: "usage and cooldowns across all agents" },
  { key: "quit", label: "Quit", hint: "" },
];

/** Arrow-key movement that never runs off either end. */
export function moveSelection(current: number, delta: number, length: number): number {
  if (length === 0) return 0;
  const next = current + delta;
  if (next < 0) return length - 1;
  if (next >= length) return 0;
  return next;
}

/** Keep the streaming pane bounded — a long run must not eat memory. */
export const MAX_PANE_LINES = 200;

export function appendLine(lines: string[], line: string, max = MAX_PANE_LINES): string[] {
  const next = [...lines, line];
  return next.length <= max ? next : next.slice(next.length - max);
}

/** Minimal text field: what a keypress does to the buffer. */
export function applyKey(buffer: string, input: string, key: { backspace?: boolean; delete?: boolean }): string {
  if (key.backspace === true || key.delete === true) return buffer.slice(0, -1);
  // Ignore control characters; printable input only.
  // eslint-disable-next-line no-control-regex -- filtering control chars is the point
  if (/[\x00-\x1f]/.test(input)) return buffer;
  return buffer + input;
}
