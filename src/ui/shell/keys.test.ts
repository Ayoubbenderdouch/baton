import { describe, expect, it } from "vitest";
import { DOUBLE_PRESS_MS, resolveKey } from "./keys.js";

const idle = { running: false, now: 1_000_000 };
const busy = { running: true, now: 1_000_000 };

describe("keybindings", () => {
  it("runs on enter when idle, ignores it mid-run", () => {
    expect(resolveKey("", { return: true }, idle, "fix it")).toEqual({ kind: "submit" });
    expect(resolveKey("", { return: true }, busy, "fix it")).toEqual({ kind: "none" });
  });

  it("esc interrupts a run and quits an idle screen", () => {
    expect(resolveKey("", { escape: true }, busy, "")).toEqual({ kind: "interrupt" });
    expect(resolveKey("", { escape: true }, idle, "")).toEqual({ kind: "quit" });
  });

  it("asks for a second ctrl+c, then quits", () => {
    expect(resolveKey("c", { ctrl: true }, idle, "")).toEqual({ kind: "confirm-quit" });
    const soon = { ...idle, lastQuitPressAt: idle.now - 500 };
    expect(resolveKey("c", { ctrl: true }, soon, "")).toEqual({ kind: "quit" });
  });

  it("forgets the first ctrl+c after the window closes", () => {
    const late = { ...idle, lastQuitPressAt: idle.now - DOUBLE_PRESS_MS - 1 };
    expect(resolveKey("c", { ctrl: true }, late, "")).toEqual({ kind: "confirm-quit" });
  });

  it("maps the shortcuts to their views", () => {
    expect(resolveKey("s", { ctrl: true }, idle, "")).toEqual({ kind: "status" });
    expect(resolveKey("d", { ctrl: true }, idle, "")).toEqual({ kind: "doctor" });
    expect(resolveKey("r", { ctrl: true }, idle, "")).toEqual({ kind: "toggle-results" });
    expect(resolveKey("", { tab: true }, idle, "")).toEqual({ kind: "cycle-agent" });
  });

  it("works mid-run too, where it makes sense", () => {
    expect(resolveKey("r", { ctrl: true }, busy, "")).toEqual({ kind: "toggle-results" });
    expect(resolveKey("s", { ctrl: true }, busy, "")).toEqual({ kind: "status" });
  });

  it("edits the buffer only while idle", () => {
    expect(resolveKey("a", {}, idle, "fix")).toEqual({ kind: "edit", text: "fixa" });
    expect(resolveKey("", { backspace: true }, idle, "fix")).toEqual({ kind: "edit", text: "fi" });
    expect(resolveKey("a", {}, busy, "fix")).toEqual({ kind: "none" });
  });

  it("keeps spaces, ignores control characters, accepts Arabic and emoji", () => {
    expect(resolveKey(" ", {}, idle, "x")).toEqual({ kind: "edit", text: "x " });
    expect(resolveKey("\u0000", {}, idle, "x")).toEqual({ kind: "none" });
    expect(resolveKey("\u0623", {}, idle, "")).toEqual({ kind: "edit", text: "\u0623" });
    expect(resolveKey("\ud83c\udfc3", {}, idle, "x")).toEqual({ kind: "edit", text: "x\ud83c\udfc3" });
  });
});
