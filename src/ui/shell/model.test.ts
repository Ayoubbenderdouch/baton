import { describe, expect, it } from "vitest";
import type { DetectResult } from "../../core/types.js";
import { MENU, appendLine, applyKey, headlineFor, moveSelection, summarize } from "./model.js";

const ready = (id: DetectResult["id"], version: string): DetectResult => ({
  id,
  installed: true,
  version,
  auth: "not_probed",
  verdict: "ready",
});

describe("welcome summary", () => {
  it("shows a version for a ready agent and marks it ready", () => {
    const summary = summarize([ready("claude", "2.1.243")], () => undefined);
    expect(summary.rows[0]).toEqual({ id: "claude", mark: "ready", label: "2.1.243" });
    expect(summary.canContinue).toBe(true);
  });

  it("says signed in only once a login was actually verified", () => {
    const probed = summarize([{ ...ready("claude", "2.1.243"), auth: "ok" }], () => undefined);
    expect(probed.rows[0]?.label).toBe("signed in \u00b7 2.1.243");
  });

  it("carries the provider's own command for an agent that is missing", () => {
    const summary = summarize(
      [
        {
          id: "gemini",
          installed: false,
          auth: "not_probed",
          verdict: "not_installed",
          remedy: "npm i -g @google/gemini-cli",
        },
      ],
      () => undefined,
    );
    expect(summary.rows[0]).toMatchObject({
      mark: "blocked",
      label: "not installed",
      remedy: "npm i -g @google/gemini-cli",
    });
    expect(summary.canContinue).toBe(false);
  });

  it("shows a sign-in problem as the provider's login command, never as a Baton action", () => {
    const summary = summarize(
      [
        {
          id: "codex",
          installed: true,
          version: "0.147.0",
          auth: "signed_out",
          verdict: "auth",
          remedy: "codex login",
        },
      ],
      () => undefined,
    );
    expect(summary.rows[0]).toMatchObject({ label: "not signed in", remedy: "codex login" });
  });

  it("marks a cooling agent with its reset hint", () => {
    const summary = summarize([ready("claude", "2.1.243")], () => "resets 19:00");
    expect(summary.rows[0]).toMatchObject({ mark: "cooling", label: "resets 19:00" });
    expect(summary.canContinue).toBe(false);
  });

  it("words the headline by how much is actually usable", () => {
    expect(headlineFor(0, 3)).toContain("no agent is ready");
    expect(headlineFor(1, 3)).toContain("nothing to relay to yet");
    expect(headlineFor(3, 3)).toContain("can relay");
  });
});

describe("menu movement", () => {
  it("wraps at both ends", () => {
    expect(moveSelection(0, -1, MENU.length)).toBe(MENU.length - 1);
    expect(moveSelection(MENU.length - 1, 1, MENU.length)).toBe(0);
    expect(moveSelection(1, 1, MENU.length)).toBe(2);
  });

  it("survives an empty list", () => {
    expect(moveSelection(0, 1, 0)).toBe(0);
  });

  it("offers quitting as the last item", () => {
    expect(MENU.at(-1)?.key).toBe("quit");
  });
});

describe("pane buffer", () => {
  it("keeps only the newest lines", () => {
    let lines: string[] = [];
    for (let index = 0; index < 250; index += 1) lines = appendLine(lines, `line ${index}`, 200);
    expect(lines).toHaveLength(200);
    expect(lines.at(-1)).toBe("line 249");
    expect(lines[0]).toBe("line 50");
  });
});

describe("text field", () => {
  it("appends printable input and deletes backwards", () => {
    let buffer = "";
    for (const char of "fix") buffer = applyKey(buffer, char, {});
    expect(buffer).toBe("fix");
    expect(applyKey(buffer, "", { backspace: true })).toBe("fi");
  });

  it("ignores control characters", () => {
    expect(applyKey("ok", "\r", {})).toBe("ok");
    expect(applyKey("ok", "\u001b", {})).toBe("ok");
  });

  it("accepts Arabic and emoji", () => {
    expect(applyKey("", "\u0623", {})).toBe("\u0623");
    expect(applyKey("x", "\ud83c\udfc3", {})).toBe("x\ud83c\udfc3");
  });
});
