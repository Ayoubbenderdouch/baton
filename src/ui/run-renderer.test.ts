import stripAnsi from "strip-ansi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGlyphProfile } from "./glyphs.js";
import { messages } from "./messages.js";
import { RunRenderer } from "./run-renderer.js";

/**
 * The non-interactive view. A pipe, a CI log and `--quiet` must all get the same
 * information as the rich view, as plain prefixed lines: no spinner, no cursor
 * movement, no borders, no colour (docs/CROSS-PLATFORM.md).
 */
let written: string[] = [];

beforeEach(() => {
  written = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  setGlyphProfile("unicode");
});

afterEach(() => {
  vi.restoreAllMocks();
  setGlyphProfile("auto");
});

const output = (): string => written.join("");
const lines = (): string[] => stripAnsi(output()).split("\n").filter((line) => line !== "");

function transcript(renderer: RunRenderer): void {
  renderer.task("fix the flaky auth test");
  renderer.routerNote(messages.routerDecision("claude", 'keyword "fix"'));
  renderer.agentStart("claude");
  renderer.event({ type: "tool", name: "Read", detail: "src/auth/session.test.ts" });
  renderer.event({ type: "text", text: "The flakiness comes from a shared fixture.\n\n" });
  renderer.event({ type: "usage", inputTokens: 3000, outputTokens: 100 });
  renderer.relay({
    from: "claude",
    to: "codex",
    resetHint: "resets ~19:00",
    handoffPath: "/work/my-app/HANDOFF.md",
  });
  renderer.agentStart("codex");
  renderer.event({ type: "text", text: "Picked it up and fixed the fixture.\n\n" });
  renderer.agentDone("codex", 192_000, 2);
}

describe("non-TTY transcript", () => {
  it("is plain, prefixed, and carries the whole story", () => {
    transcript(new RunRenderer({ quiet: true }));
    const text = lines().join("\n");

    expect(text).toMatchSnapshot();
    // Every line is prefixed and nothing is decorative.
    expect(lines().every((line) => line.startsWith("baton: "))).toBe(true);
    expect(text).not.toContain("╭");
    expect(text).not.toContain("▐");
    expect(text).not.toContain("⏺");
  });

  it("emits no escape sequences at all — no colour, no cursor movement", () => {
    transcript(new RunRenderer({ quiet: true }));
    // eslint-disable-next-line no-control-regex -- asserting the absence of escapes
    expect(/\x1b/.test(output())).toBe(false);
  });

  it("still names the relay, the limit and the handoff", () => {
    transcript(new RunRenderer({ quiet: true }));
    const text = lines().join("\n");
    expect(text).toContain("claude usage limit reached (resets ~19:00)");
    expect(text).toContain("passing the baton to codex");
    expect(text).toContain("HANDOFF.md");
  });

  it("reports errors remedy-first without a stack trace", () => {
    const renderer = new RunRenderer({ quiet: true });
    renderer.fail("codex: not signed in", "run: codex   (then retry)", "~/.baton/last-error.log");
    expect(lines()).toEqual([
      "baton: codex: not signed in",
      "baton: run: codex   (then retry)",
      "baton: log: ~/.baton/last-error.log",
    ]);
  });
});

describe("ascii profile in a pipe", () => {
  it("emits pure ASCII, so a legacy console shows no question marks", () => {
    setGlyphProfile("ascii");
    const renderer = new RunRenderer({ quiet: true });
    transcript(renderer);
    // Prose too, not just the structural glyphs.
    renderer.note("still working — no output for 2 min");
    renderer.fail("codex: not signed in", "run: codex   (then retry)");
    const text = output();
    const nonAscii = [...new Set([...text].filter((char) => char.charCodeAt(0) > 127))];
    expect(nonAscii, `non-ASCII characters leaked: ${nonAscii.join(" ")}`).toEqual([]);
    expect(stripAnsi(text)).toMatchSnapshot();
  });
});

describe("rich transcript (a real terminal)", () => {
  it("uses the same visual system as the shell", () => {
    // `sink` means someone else owns the screen, which is exactly the rich path.
    const collected: string[] = [];
    const renderer = new RunRenderer({ columns: 72, sink: (line) => collected.push(line) });
    transcript(renderer);
    const text = stripAnsi(collected.join("\n"));

    expect(text).toMatchSnapshot();
    expect(text).toContain("❯ fix the flaky auth test");
    expect(text).toContain("⏺ Read src/auth/session.test.ts");
    expect(text).toContain("⚡ [claude] usage limit reached · resets ~19:00");
    expect(text).toContain("⇥ passing the baton → [codex]");
    expect(text).toContain("◆ done · [codex] · 3m 12s · 2 files changed");
  });
});
