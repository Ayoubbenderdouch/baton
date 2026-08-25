import stripAnsi from "strip-ansi";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chipsLine,
  doneLine,
  errorBlock,
  formatElapsed,
  headerLine,
  hintLine,
  promptEcho,
  relayBlock,
  resultLines,
  statusLine,
  table,
  toolLine,
  verbFor,
} from "./format.js";
import { setGlyphProfile } from "./glyphs.js";
import { messages } from "./messages.js";
import { truncateMiddle, width } from "./width.js";

import os from "node:os";
import nodePath from "node:path";

/** Backslashes only differ by platform, never by width — normalise for snapshots. */
const plain = (text: string): string => stripAnsi(text).replace(/\\/g, "/");
/**
 * A path under the home directory renders as `~/projects/my-app` on POSIX and
 * `~\projects\my-app` on Windows: same number of cells, so the padding is identical and
 * one snapshot covers both.
 */
const HOME_PROJECT = nodePath.join(os.homedir(), "projects", "my-app");
const plainAll = (lines: string[]): string => stripAnsi(lines.join("\n"));

beforeEach(() => setGlyphProfile("unicode"));
afterEach(() => setGlyphProfile("auto"));

describe("header", () => {
  it("keeps name, version and folder on one line", () => {
    const line = plain(headerLine({ version: "0.1.0", cwd: HOME_PROJECT, columns: 72 }));
    expect(line.split("\n")).toHaveLength(1);
    expect(width(line)).toBeLessThanOrEqual(72);
    expect(line).toMatchSnapshot();
  });

  it("truncates the folder through the middle rather than wrapping", () => {
    const line = plain(
      headerLine({
        version: "0.1.0",
        cwd: nodePath.join(os.homedir(), "very", "deep", "nested", "path", "keeps", "going", "my-app"),
        columns: 46,
      }),
    );
    expect(line.split("\n")).toHaveLength(1);
    expect(width(line)).toBeLessThanOrEqual(46);
    expect(line).toContain("…");
    expect(line).toContain("my-app");
  });

  it("drops the folder entirely rather than breaking the header", () => {
    const line = plain(headerLine({ version: "0.1.0", cwd: HOME_PROJECT, columns: 20 }));
    expect(line.split("\n")).toHaveLength(1);
  });
});

describe("running block", () => {
  it("renders the prompt echo, status line, tool line and nested result", () => {
    const block = [
      ...promptEcho("fix the flaky auth test", 72),
      statusLine({ agent: "claude", elapsedMs: 12_000, tokens: 3100, columns: 72, verb: "Sprinting" }),
      toolLine({ agent: "claude", name: "Read", detail: "src/auth/session.test.ts", columns: 72 }),
      toolLine({ agent: "claude", name: "Bash", detail: "npm test -- auth", columns: 72 }),
      ...resultLines("2 passed, 1 failed\nline two\nline three\nline four\nline five", {
        expanded: false,
        columns: 72,
      }),
    ];
    expect(plainAll(block)).toMatchSnapshot();
  });

  it("puts the interrupt hint on the right edge", () => {
    const line = plain(statusLine({ agent: "claude", elapsedMs: 1000, columns: 72 }));
    expect(line.endsWith(messages.interruptHint)).toBe(true);
    expect(width(line)).toBeLessThanOrEqual(72);
  });

  it("drops the hint instead of overflowing a narrow terminal", () => {
    const line = plain(statusLine({ agent: "claude", elapsedMs: 1000, columns: 26 }));
    expect(line).not.toContain(messages.interruptHint);
  });

  it("rotates the verb roughly every eight seconds and never runs out", () => {
    expect(verbFor(0)).toBe(messages.workingVerbs[0]);
    expect(verbFor(8_000)).toBe(messages.workingVerbs[1]);
    expect(verbFor(8_000 * messages.workingVerbs.length)).toBe(messages.workingVerbs[0]);
    expect(verbFor(999_999_999)).toBeTruthy();
  });

  it("collapses tool output to three lines with an expand hint", () => {
    const collapsed = resultLines("a\nb\nc\nd\ne", { expanded: false, columns: 72 });
    expect(collapsed).toHaveLength(4);
    expect(plain(collapsed[3] ?? "")).toContain("+2 lines (ctrl+r to expand)");

    const expanded = resultLines("a\nb\nc\nd\ne", { expanded: true, columns: 72 });
    expect(expanded.length).toBeGreaterThan(collapsed.length);
    expect(plain(expanded.at(-1) ?? "")).toContain("ctrl+r to collapse");
  });

  it("formats elapsed time the way a human reads it", () => {
    expect(formatElapsed(12_000)).toBe("12s");
    expect(formatElapsed(192_000)).toBe("3m 12s");
  });
});

describe("relay block", () => {
  it("is two loud lines with a blank line above and below", () => {
    const block = relayBlock({
      from: "claude",
      to: "codex",
      resetHint: "resets ~19:00",
      handoffPath: "/work/my-app/HANDOFF.md",
    });
    expect(block[0]).toBe("");
    expect(block.at(-1)).toBe("");
    expect(plainAll(block)).toMatchSnapshot();
  });

  it("names both agents and never hides in dim text", () => {
    const block = relayBlock({ from: "claude", to: "gemini" });
    const text = plainAll(block);
    expect(text).toContain("[claude]");
    expect(text).toContain("[gemini]");
    expect(text).toContain("passing the baton");
  });
});

describe("completion and errors", () => {
  it("reports done with agent, time, files and that the session was saved", () => {
    expect(plain(doneLine({ agent: "claude", durationMs: 192_000, filesChanged: 2 }))).toMatchSnapshot();
  });

  it("says one file, not 1 files", () => {
    expect(plain(doneLine({ agent: "codex", durationMs: 1000, filesChanged: 1 }))).toContain(
      "1 file changed",
    );
  });

  it("puts the remedy first and the log last, three lines at most", () => {
    const block = errorBlock({
      what: "codex: not signed in",
      remedy: "run: codex   (then retry)",
      logPath: "~/.baton/last-error.log",
    });
    expect(block).toHaveLength(3);
    expect(plainAll(block)).toMatchSnapshot();
  });
});

describe("chips and hints", () => {
  it("shows each agent with its state and reset hint", () => {
    const line = plain(
      chipsLine([
        { agent: "claude", mark: "ready", detail: "ready" },
        { agent: "codex", mark: "ready", detail: "ready" },
        { agent: "gemini", mark: "cooling", detail: "cooling · ~19:00" },
      ]),
    );
    expect(line).toBe("claude ● ready    codex ● ready    gemini ◌ cooling · ~19:00");
  });

  it("joins hints with a middle dot", () => {
    expect(plain(hintLine(["enter run", "esc quit"]))).toBe("enter run · esc quit");
  });
});

describe("tables", () => {
  it("aligns columns by visible width, not by character count", () => {
    const lines = table(
      ["AGENT", "STATE"],
      [
        ["[claude]", "ready"],
        ["[コーデックス]", "cooling"],
      ],
    );
    const widths = lines.map((line) => width(stripAnsi(line).trimEnd()));
    // Every row starts its second column at the same cell.
    const columnStarts = lines.map((line) => stripAnsi(line).indexOf("  ") );
    expect(new Set(widths).size).toBeGreaterThan(0);
    expect(columnStarts.every((start) => start > 0)).toBe(true);
  });
});

describe("width rules", () => {
  it("counts CJK as two cells and zero-width joiners as none", () => {
    expect(width("abc")).toBe(3);
    expect(width("日本語")).toBe(6);
    expect(width("a\u200db")).toBe(2);
  });

  it("truncates through the middle, keeping both ends", () => {
    const short = truncateMiddle("/very/long/path/to/a/project", 16);
    expect(width(short)).toBeLessThanOrEqual(16);
    expect(short.startsWith("/very")).toBe(true);
    expect(short.endsWith("project")).toBe(true);
  });
});

describe("ascii profile", () => {
  it("swaps every structural glyph for a safe one", () => {
    setGlyphProfile("ascii");
    const text = plainAll([
      headerLine({ version: "0.1.0", cwd: HOME_PROJECT, columns: 60 }),
      statusLine({ agent: "claude", elapsedMs: 1000, columns: 60, verb: "Sprinting" }),
      toolLine({ agent: "claude", name: "Read", detail: "a.ts", columns: 60 }),
      ...relayBlock({ from: "claude", to: "codex" }),
      doneLine({ agent: "claude", durationMs: 1000, filesChanged: 0 }),
      ...errorBlock({ what: "codex: not signed in", remedy: "run: codex" }),
    ]);
    for (const glyph of ["▌", "▐", "❯", "⏺", "⎿", "●", "◌", "◆", "⚡", "⇥", "✗", "…"]) {
      expect(text).not.toContain(glyph);
    }
    expect(text).toMatchSnapshot();
  });
});
