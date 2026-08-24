import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RELAY_PREAMBLE,
  appendToSummary,
  detectVerifyCommands,
  renderHandoff,
  type HandoffInput,
} from "./handoff.js";

const baseInput: HandoffInput = {
  task: "fix the flaky auth test",
  previousAgent: "claude",
  stoppedBy: "usage limit",
  relayCount: 1,
  maxRelays: 2,
  summary: "- Read src/auth/session.test.ts\n- Found a fixture shared between two tests",
  filesTouched: ["src/auth/session.test.ts", "src/auth/fixtures.ts"],
  nextSteps: "- Make the fixture per-test, then run the suite again.",
  constraints: ["Project conventions are written in CLAUDE.md — follow them, do not re-litigate."],
  verifyCommands: ["npm test"],
  now: "2026-08-24T21:00:00.000Z",
};

describe("RELAY_PREAMBLE", () => {
  it("matches docs/FAILOVER.md word for word", () => {
    // The doc is normative; drift between the two is the bug this test exists to catch.
    const doc = readFileSync(path.join(process.cwd(), "docs", "FAILOVER.md"), "utf8");
    const marker = "`RELAY_PREAMBLE` (exact string, keep stable";
    const afterMarker = doc.slice(doc.indexOf(marker));
    const block = /```\n([\s\S]*?)```/.exec(afterMarker)?.[1];
    expect(block).toBeDefined();
    expect(RELAY_PREAMBLE.trim()).toBe((block ?? "").trim());
  });

  it("tells the next agent where the briefing is and not to ask questions", () => {
    expect(RELAY_PREAMBLE).toContain("HANDOFF.md");
    expect(RELAY_PREAMBLE).toContain("Do not restart completed work");
    expect(RELAY_PREAMBLE).toContain("non-interactive run");
  });
});

describe("renderHandoff", () => {
  it("matches the template in docs/FAILOVER.md §4", () => {
    expect(renderHandoff(baseInput)).toMatchInlineSnapshot(`
      "# HANDOFF — 2026-08-24T21:00:00.000Z

      ## Task
      fix the flaky auth test

      ## Status
      - Previous agent: claude (stopped: usage limit)
      - Relay count for this task: 1/2

      ## Done so far
      - Read src/auth/session.test.ts
      - Found a fixture shared between two tests

      ## Files touched (git)
      - src/auth/session.test.ts
      - src/auth/fixtures.ts

      ## In progress / next steps
      - Make the fixture per-test, then run the suite again.

      ## Constraints & decisions already made
      - Project conventions are written in CLAUDE.md — follow them, do not re-litigate.

      ## How to verify
      - \`npm test\`
      "
    `);
  });

  it("is deterministic for the same input", () => {
    expect(renderHandoff(baseInput)).toBe(renderHandoff(baseInput));
  });

  it("says so plainly when there is no git repo", () => {
    const text = renderHandoff({ ...baseInput, filesTouched: undefined });
    expect(text).toContain("(not a git repo)");
  });

  it("survives an empty session", () => {
    const text = renderHandoff({
      ...baseInput,
      summary: "",
      filesTouched: [],
      nextSteps: "",
      constraints: [],
      verifyCommands: [],
    });
    expect(text).toContain("- (nothing recorded yet)");
    expect(text).toContain("(no files changed yet)");
    expect(text).toContain("- Continue the task above.");
    expect(text).toContain("- (no verification command detected)");
  });

  it("carries Arabic and emoji through unchanged", () => {
    const task = readFileSync(path.join(process.cwd(), "fixtures", "unicode-task.txt"), "utf8");
    const text = renderHandoff({ ...baseInput, task });
    expect(text).toContain("أصلح اختبار المصادقة المتقطع");
    expect(text).toContain("🏃⚡");
    // No CRLF ever reaches the file, whatever platform wrote it.
    expect(text.includes("\r")).toBe(false);
  });

  it("compresses the history instead of dropping the next steps", () => {
    const long = Array.from({ length: 200 }, (_, i) => `- step ${i} did something specific`).join(
      "\n",
    );
    const text = renderHandoff({ ...baseInput, summary: long });
    expect(text).toContain("steps compressed");
    expect(text).toContain("- Make the fixture per-test, then run the suite again.");
    expect(text.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(800);
  });
});

describe("appendToSummary", () => {
  it("appends one bullet per turn", () => {
    expect(appendToSummary("", "read the failing test")).toBe("- read the failing test");
    expect(appendToSummary("- a", "b")).toBe("- a\n- b");
  });

  it("collapses whitespace and ignores empty entries", () => {
    expect(appendToSummary("- a", "  \n  ")).toBe("- a");
    expect(appendToSummary("", " two   words ")).toBe("- two words");
  });

  it("folds the oldest entries into a digest past the limit", () => {
    let summary = "";
    for (let i = 0; i < 60; i += 1) {
      summary = appendToSummary(summary, `turn ${i} changed a handful of files somewhere`, 400);
    }
    expect(summary.length).toBeLessThanOrEqual(400);
    expect(summary.split("\n")[0]).toMatch(/^- earlier: \d+ steps compressed$/);
    expect(summary).toContain("turn 59");
    // The digest counts every folded entry exactly once.
    const folded = Number(/(\d+)/.exec(summary.split("\n")[0] ?? "")?.[1]);
    expect(folded + summary.split("\n").length - 1).toBe(60);
  });
});

describe("detectVerifyCommands", () => {
  it("finds this repo's own scripts", async () => {
    const commands = await detectVerifyCommands(process.cwd());
    expect(commands).toContain("npm test");
    expect(commands).toContain("npm run lint");
  });

  it("returns nothing for a directory with no project files", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    expect(await detectVerifyCommands(mkdtempSync(path.join(tmpdir(), "baton-empty-")))).toEqual([]);
  });
});
