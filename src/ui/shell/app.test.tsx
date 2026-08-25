import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import React from "react";
import { render } from "ink-testing-library";
import stripAnsi from "strip-ansi";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setGlyphProfile } from "../glyphs.js";
import { App } from "./app.js";

/**
 * The screens are rendered for real and snapshotted without colour, so the layout - the
 * point of this overhaul - is pinned character for character.
 *
 * PATH is emptied and BATON_TEST_FAKE supplies the agents, so nothing here touches a
 * provider CLI, an account or the network.
 */
const originalPath = process.env.PATH;
const originalHome = process.env.BATON_HOME;
const dirs: string[] = [];

beforeEach(() => {
  const home = mkdtempSync(path.join(tmpdir(), "baton-ui-"));
  dirs.push(home);
  process.env.BATON_HOME = home;
  process.env.PATH = path.join(home, "empty");
  process.env.BATON_TEST_FAKE = "1";
  setGlyphProfile("unicode");
});

afterEach(() => {
  process.env.PATH = originalPath;
  if (originalHome === undefined) delete process.env.BATON_HOME;
  else process.env.BATON_HOME = originalHome;
  delete process.env.BATON_TEST_FAKE;
  setGlyphProfile("auto");
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const settle = (ms = 300): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (text: string): string => stripAnsi(text).replace(/[ \t]+$/gm, "");
const lastFrame = (app: { lastFrame: () => string | undefined }): string => clean(app.lastFrame() ?? "");
/** Everything ever drawn, including the <Static> history that scrolled away. */
const transcript = (app: { frames: string[] }): string => clean(app.frames.join("\n"));

/** Layout tests use a fixed path so the header snapshot is stable. */
function mount(cwd = "/work/my-app"): ReturnType<typeof render> {
  return render(React.createElement(App, { initialCwd: cwd, version: "0.1.0" }));
}

describe("idle screen", () => {
  it("matches the target layout", async () => {
    const app = mount();
    await settle();
    expect(lastFrame(app)).toMatchSnapshot();
    app.unmount();
  });

  it("puts the header on one line, the input in a box, and the chips under it", async () => {
    const app = mount();
    await settle();
    const lines = lastFrame(app).split("\n").filter((line) => line.trim() !== "");

    expect(lines[0]).toMatch(/^▌ baton {2}v0\.1\.0\s+\/work\/my-app$/);
    // The input box is the anchor of the screen, not a floating prompt.
    expect(lines[1]?.startsWith("╭")).toBe(true);
    expect(lines[2]).toMatch(/^│ ❯ describe a task…/);
    expect(lines[3]?.startsWith("╰")).toBe(true);
    // Chips directly under the input, then exactly one hint line.
    expect(lines[4]).toBe("claude ● ready    codex ● ready    gemini ● ready");
    expect(lines[5]).toBe("enter run · tab agent · ctrl+s status · ctrl+d doctor · esc quit");
    expect(lines).toHaveLength(6);
    app.unmount();
  });

  it("locks an agent with tab and says so", async () => {
    const app = mount();
    await settle();
    app.stdin.write("\t");
    await settle(150);
    expect(lastFrame(app)).toContain("agent locked to claude");
    app.unmount();
  });

  it("wants a second ctrl+c before it dies", async () => {
    const app = mount();
    await settle();
    app.stdin.write("\u0003");
    await settle(150);
    expect(lastFrame(app)).toContain("press ctrl+c again to quit");
    app.unmount();
  });

  it("types into the box", async () => {
    const app = mount();
    await settle();
    for (const char of "fix the test") app.stdin.write(char);
    await settle(150);
    expect(lastFrame(app)).toContain("❯ fix the test");
    expect(lastFrame(app)).not.toContain("describe a task…");
    app.unmount();
  });
});

describe("ascii profile", () => {
  it("renders the same screen with safe glyphs", async () => {
    setGlyphProfile("ascii");
    const app = mount();
    await settle();
    const text = lastFrame(app);
    for (const glyph of ["❯", "●", "◌", "╭", "│", "╰", "▌", "…"]) {
      expect(text, `${glyph} survived the ascii profile`).not.toContain(glyph);
    }
    expect(text).toContain("> describe a task...");
    expect(text).toMatchSnapshot();
    app.unmount();
  });
});

describe("running a task", () => {
  it("echoes the prompt, shows a status line, then a done line", async () => {
    // A real folder: the run writes .baton/session.json and HANDOFF.md into it.
    const app = mount(dirs[dirs.length - 1] as string);
    await settle();
    for (const char of "say ok") app.stdin.write(char);
    await settle(150);
    app.stdin.write("\r");
    await settle(1200);

    const everything = transcript(app);
    expect(everything).toContain("❯ say ok");
    expect(everything).toMatch(/▐ \[claude\]|◆ done/);
    expect(everything).toMatch(/◆ done · \[claude\] · \d+s · 0 files changed · session saved/);
    // The input box comes back once the agent is finished.
    expect(lastFrame(app)).toContain("describe a task…");
    app.unmount();
  });
});
