import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { readClaudeLocalHistory, readCodexLocalHistory } from "./deep-history.js";
import { buildStatusReport, formatTokens } from "./status.js";
import { UsageStore } from "./usage-store.js";
import { renderStatus } from "../ui/render.js";

const NOW = new Date("2026-08-24T18:00:00.000Z");
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
async function emptyStore(): Promise<UsageStore> {
  const dir = mkdtempSync(path.join(tmpdir(), "baton-status-"));
  dirs.push(dir);
  return UsageStore.load(dir);
}

describe("baton status with no data at all", () => {
  it("says so per agent instead of showing zeros", async () => {
    const report = buildStatusReport(await emptyStore(), {
      project: "/work/project",
      now: NOW,
      cooldownMinutes: 30,
    });
    expect(report.agents).toHaveLength(3);
    expect(report.agents.every((agent) => agent.noData)).toBe(true);
    expect(report.agents.every((agent) => !agent.cooling)).toBe(true);
    const rendered = renderStatus(report, { deep: false });
    expect(rendered).toContain("no data yet");
    expect(rendered).toContain("BATON STATUS");
  });
});

describe("baton status with partial data", () => {
  it("counts only today's runs and keeps the rest of the history out of the numbers", async () => {
    const usage = await emptyStore();
    usage.recordTurn({
      ts: "2026-08-20T09:00:00.000Z",
      agent: "claude",
      project: "/work/project",
      inputTokens: 999_999,
      outputTokens: 999_999,
      endedBy: "done",
    });
    usage.recordTurn({
      ts: "2026-08-24T09:00:00.000Z",
      agent: "claude",
      project: "/work/project",
      inputTokens: 41_000,
      outputTokens: 9_000,
      endedBy: "done",
    });
    usage.recordTurn({
      ts: "2026-08-24T12:00:00.000Z",
      agent: "codex",
      project: "/work/project",
      endedBy: "error",
    });

    const report = buildStatusReport(usage, {
      project: "/work/project",
      now: NOW,
      cooldownMinutes: 30,
    });
    const claude = report.agents.find((agent) => agent.agent === "claude");
    expect(claude?.runsToday).toBe(1);
    expect(claude?.inputTokensToday).toBe(41_000);
    expect(claude?.noData).toBe(false);

    const codex = report.agents.find((agent) => agent.agent === "codex");
    // A run that reported no token counts still counts as a run — no invented numbers.
    expect(codex?.runsToday).toBe(1);
    expect(codex?.inputTokensToday).toBe(0);

    const gemini = report.agents.find((agent) => agent.agent === "gemini");
    expect(gemini?.noData).toBe(true);
  });
});

describe("baton status with every agent cooling", () => {
  it("shows each cooldown with its reset hint", async () => {
    const usage = await emptyStore();
    for (const agent of ["claude", "codex", "gemini"] as const) {
      usage.recordLimit({
        ts: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
        agent,
        project: "/work/project",
        resetHint: `resets ${agent === "claude" ? "19:00" : "20:00"}`,
      });
    }
    const report = buildStatusReport(usage, {
      project: "/work/project",
      now: NOW,
      cooldownMinutes: 30,
    });
    expect(report.agents.every((agent) => agent.cooling)).toBe(true);
    const rendered = renderStatus(report, { deep: false });
    expect(rendered).toContain("cooling");
    expect(rendered).toContain("resets 19:00");
    expect(rendered).toContain("resets 20:00");
  });
});

describe("--deep local history (read-only, defensive)", () => {
  const root = (agent: string): string =>
    path.join(process.cwd(), "fixtures", "local-history", agent);

  it("sums claude's local transcripts and ignores junk lines", async () => {
    const totals = await readClaudeLocalHistory(path.join(root("claude"), "projects"));
    expect(totals).toEqual({
      agent: "claude",
      inputTokens: 1500,
      outputTokens: 52,
      entries: 2,
    });
  });

  it("sums codex's session logs", async () => {
    const totals = await readCodexLocalHistory(path.join(root("codex"), "sessions"));
    expect(totals).toEqual({
      agent: "codex",
      inputTokens: 7500,
      outputTokens: 350,
      entries: 2,
    });
  });

  it("returns zeros for a directory that does not exist", async () => {
    const totals = await readClaudeLocalHistory("/definitely/not/here");
    expect(totals.entries).toBe(0);
    expect(totals.inputTokens).toBe(0);
  });

  it("respects a since date", async () => {
    const totals = await readClaudeLocalHistory(
      path.join(root("claude"), "projects"),
      new Date("2026-08-24T09:00:30.000Z"),
    );
    expect(totals.entries).toBe(1);
    expect(totals.inputTokens).toBe(300);
  });
});

describe("formatTokens", () => {
  it("keeps small numbers exact and shortens big ones", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(41_000)).toBe("41k");
    expect(formatTokens(15_667)).toBe("15.7k");
    expect(formatTokens(120_400)).toBe("120k");
  });
});
