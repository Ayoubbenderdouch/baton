import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";
import React from "react";
import { render } from "ink-testing-library";
import stripAnsi from "strip-ansi";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setGlyphProfile } from "../glyphs.js";
import { App } from "./app.js";

/**
 * The palette, driven by keystrokes and snapshotted without colour.
 * BATON_TEST_FAKE supplies the agents; PATH is empty; nothing here touches a provider.
 */
const originalPath = process.env.PATH;
const originalHome = process.env.BATON_HOME;
const dirs: string[] = [];
let project: string;

beforeEach(() => {
  const home = mkdtempSync(path.join(tmpdir(), "baton-palette-"));
  dirs.push(home);
  project = mkdtempSync(path.join(tmpdir(), "baton-project-"));
  dirs.push(project);
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
const clean = (text: string): string =>
  stripAnsi(text).replace(/[ \t]+$/gm, "").replace(/\\/g, "/");
const frame = (app: { lastFrame: () => string | undefined }): string => clean(app.lastFrame() ?? "");
const all = (app: { frames: string[] }): string => clean(app.frames.join("\n"));

/** Home-relative so the header renders at the same width on every platform. */
const HOME_PROJECT = path.join(os.homedir(), "projects", "my-app");

function mount(options: { cwd?: string; suspend?: AppSuspend } = {}): ReturnType<typeof render> {
  return render(
    React.createElement(App, {
      initialCwd: options.cwd ?? HOME_PROJECT,
      version: "0.1.0",
      ...(options.suspend !== undefined ? { suspend: options.suspend } : {}),
    }),
  );
}

type AppSuspend = (bin: string, args: string[], note?: string) => Promise<number>;

const type = async (app: ReturnType<typeof render>, text: string): Promise<void> => {
  for (const char of text) app.stdin.write(char);
  await settle(150);
};

describe("opening the palette", () => {
  it("opens on the first slash and lists every command", async () => {
    const app = mount();
    await settle();
    await type(app, "/");
    expect(frame(app)).toMatchSnapshot();
    app.unmount();
  });

  it("filters live as you type, prefix matches first", async () => {
    const app = mount();
    await settle();
    await type(app, "/lo");
    const text = frame(app);
    expect(text).toContain("/login");
    expect(text).toContain("/logout");
    expect(text).not.toContain("/status");
    expect(text).toMatchSnapshot();
    app.unmount();
  });

  it("says so when nothing matches, and keeps what was typed", async () => {
    const app = mount();
    await settle();
    await type(app, "/zzz");
    const text = frame(app);
    expect(text).toContain("unknown command /zzz · try /help");
    expect(text).toContain("❯ /zzz");
    expect(text).toMatchSnapshot();
    app.unmount();
  });

  it("closes on esc but keeps the text, and clears it on a second esc", async () => {
    const app = mount();
    await settle();
    await type(app, "/st");
    expect(frame(app)).toContain("/status");

    app.stdin.write("\u001B");
    await settle(150);
    expect(frame(app)).not.toContain("/status");
    expect(frame(app)).toContain("❯ /st");

    app.stdin.write("\u001B");
    await settle(150);
    expect(frame(app)).toContain("describe a task…");
    app.unmount();
  });

  it("completes the highlighted command with tab", async () => {
    const app = mount();
    await settle();
    await type(app, "/logi");
    app.stdin.write("\t");
    await settle(150);
    expect(frame(app)).toContain("❯ /login");
    app.unmount();
  });

  it("completes an agent id on the second tab", async () => {
    const app = mount();
    await settle();
    await type(app, "/login ge");
    app.stdin.write("\t");
    await settle(150);
    expect(frame(app)).toContain("/login gemini");
    app.unmount();
  });
});

describe("the argument step", () => {
  it("asks which provider when a command needs one", async () => {
    // Home-relative cwd: a temp path would make the header snapshot random.
    const app = mount();
    await settle();
    await type(app, "/login");
    app.stdin.write("\r");
    await settle(400);
    const text = frame(app);
    expect(text).toContain("pick a provider:");
    expect(text).toContain("claude");
    expect(text).toContain("(↑↓ enter esc)");
    expect(text).toMatchSnapshot();
    app.unmount();
  });

  it("cancels the picker with esc without running anything", async () => {
    const app = mount({ cwd: project });
    await settle();
    await type(app, "/logout");
    app.stdin.write("\r");
    await settle(400);
    expect(frame(app)).toContain("pick a provider:");
    app.stdin.write("\u001B");
    await settle(300);
    expect(frame(app)).not.toContain("pick a provider:");
    app.unmount();
  });
});

describe("auth delegation (stubbed child, no real provider)", () => {
  it("suspends, spawns the provider's own command, then refreshes", async () => {
    const calls: { bin: string; args: string[] }[] = [];
    const suspend: AppSuspend = async (bin, args) => {
      calls.push({ bin, args });
      return 0;
    };
    const app = mount({ cwd: project, suspend });
    await settle();
    await type(app, "/login claude");
    app.stdin.write("\r");
    await settle(800);

    // Baton spawned the provider's OWN command and nothing else.
    expect(calls).toEqual([{ bin: "claude", args: ["auth", "login"] }]);
    const text = all(app);
    expect(text).toContain("claude signed in");
    // Chips are still there, i.e. detection ran again after the child exited.
    expect(frame(app)).toMatch(/claude ●/);
    app.unmount();
  });

  it("reports a failed flow remedy-first instead of claiming success", async () => {
    const suspend: AppSuspend = async () => 1;
    const app = mount({ cwd: project, suspend });
    await settle();
    await type(app, "/login codex");
    app.stdin.write("\r");
    await settle(800);
    const text = all(app);
    expect(text).toContain("login exited with code 1");
    expect(text).toContain("→ codex login");
    expect(text).not.toContain("signed in");
    app.unmount();
  });

  it("uses the interactive fallback for a provider without an auth subcommand", async () => {
    const calls: { bin: string; args: string[]; note?: string }[] = [];
    const suspend: AppSuspend = async (bin, args, note) => {
      calls.push({ bin, args, ...(note !== undefined ? { note } : {}) });
      return 0;
    };
    const app = mount({ cwd: project, suspend });
    await settle();
    await type(app, "/login gemini");
    app.stdin.write("\r");
    await settle(800);
    expect(calls[0]?.bin).toBe("gemini");
    expect(calls[0]?.args).toEqual([]);
    expect(calls[0]?.note).toContain("complete the sign-in inside");
    app.unmount();
  });

  it("never asks for a credential itself", async () => {
    const app = mount({ cwd: project, suspend: async () => 0 });
    await settle();
    await type(app, "/login claude");
    app.stdin.write("\r");
    await settle(600);
    const text = all(app).toLowerCase();
    for (const forbidden of ["password", "api key", "token:", "paste your"]) {
      expect(text, `the shell asked for a ${forbidden}`).not.toContain(forbidden);
    }
    app.unmount();
  });
});

describe("ascii profile", () => {
  it("renders the palette with safe glyphs", async () => {
    setGlyphProfile("ascii");
    const app = mount();
    await settle();
    await type(app, "/lo");
    const text = frame(app);
    for (const glyph of ["❯", "╭", "│", "─", "…"]) {
      expect(text, `${glyph} survived the ascii profile`).not.toContain(glyph);
    }
    expect(text).toMatchSnapshot();
    app.unmount();
  });
});

describe("commands that change the shell", () => {
  it("/clear empties the transcript but says the session is untouched", async () => {
    const app = mount({ cwd: project });
    await settle();
    await type(app, "/help");
    app.stdin.write("\r");
    await settle(400);
    await type(app, "/clear");
    app.stdin.write("\r");
    await settle(400);
    expect(all(app)).toContain("transcript cleared");
    app.unmount();
  });

  it("/agent locks the router and /agent auto hands it back", async () => {
    const app = mount({ cwd: project });
    await settle();
    await type(app, "/agent codex");
    app.stdin.write("\r");
    await settle(400);
    expect(frame(app)).toContain("agent locked to codex");

    await type(app, "/agent auto");
    app.stdin.write("\r");
    await settle(400);
    expect(all(app)).toContain("router picks the agent again");
    app.unmount();
  });
});
