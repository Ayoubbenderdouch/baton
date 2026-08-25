import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import React from "react";
import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./app.js";

/**
 * The shell is rendered for real and driven by keystrokes. PATH is emptied so detection
 * finds no provider CLI: fast, offline, and it exercises the screen a first-time user
 * most needs to be right - "nothing is installed, here is what to run".
 */
const originalPath = process.env.PATH;
const originalHome = process.env.BATON_HOME;
const dirs: string[] = [];

beforeEach(() => {
  const home = mkdtempSync(path.join(tmpdir(), "baton-shell-"));
  dirs.push(home);
  process.env.BATON_HOME = home;
  process.env.PATH = path.join(home, "empty");
});

afterEach(() => {
  process.env.PATH = originalPath;
  if (originalHome === undefined) delete process.env.BATON_HOME;
  else process.env.BATON_HOME = originalHome;
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 250));
};

describe("the interactive shell", () => {
  it("greets, then lists every agent with the provider's own fix command", async () => {
    const app = render(React.createElement(App, { initialCwd: process.cwd() }));
    expect(app.lastFrame()).toContain("looking for your agent CLIs");
    await settle();
    const frame = app.lastFrame() ?? "";

    expect(frame).toContain("Pass the baton, keep the context.");
    for (const agent of ["claude", "codex", "gemini"]) expect(frame).toContain(`[${agent}]`);
    expect(frame).toContain("not installed");
    expect(frame).toContain("npm i -g @anthropic-ai/claude-code");
    expect(frame).toContain("npm i -g @openai/codex");
    expect(frame).toContain("npm i -g @google/gemini-cli");
    expect(frame).toContain("no agent is ready");
    app.unmount();
  });

  it("never offers to log you in — only the command you run yourself", async () => {
    const app = render(React.createElement(App, { initialCwd: process.cwd() }));
    await settle();
    const frame = (app.lastFrame() ?? "").toLowerCase();
    expect(frame).toContain("run:");
    // The prime rule, asserted on the screen a user actually sees.
    expect(frame).not.toContain("log you in");
    expect(frame).not.toContain("enter your");
    expect(frame).not.toContain("password");
    expect(frame).not.toContain("api key");
    app.unmount();
  });

  it("says logins are unverified until you ask, because verifying costs a request", async () => {
    const app = render(React.createElement(App, { initialCwd: process.cwd() }));
    await settle();
    expect(app.lastFrame()).toContain("costs one tiny request per agent");
    expect(app.lastFrame()).toContain("[p]");
    app.unmount();
  });

  it("refuses to continue while no agent can run", async () => {
    const app = render(React.createElement(App, { initialCwd: process.cwd() }));
    await settle();
    app.stdin.write("\r");
    await settle();
    // Still on the welcome screen: there is nothing to hand a task to.
    expect(app.lastFrame()).toContain("no agent is ready");
    expect(app.lastFrame()).not.toContain("What do you want to do?");
    app.unmount();
  });

  it("offers a way out on the first screen", async () => {
    const app = render(React.createElement(App, { initialCwd: process.cwd() }));
    await settle();
    expect(app.lastFrame()).toContain("[q]");
    expect(app.lastFrame()).toContain("quit");
    app.unmount();
  });
});

describe("the shell with agents available (BATON_TEST_FAKE)", () => {
  beforeEach(() => {
    process.env.BATON_TEST_FAKE = "1";
  });
  afterEach(() => {
    delete process.env.BATON_TEST_FAKE;
  });

  it("walks welcome -> menu and moves the selection with the arrow keys", async () => {
    const app = render(React.createElement(App, { initialCwd: process.cwd() }));
    await settle();
    expect(app.lastFrame()).toContain("can relay");

    app.stdin.write("\r");
    await settle();
    const menu = app.lastFrame() ?? "";
    expect(menu).toContain("What do you want to do?");
    for (const label of ["Run a task", "Choose project folder", "Show status", "Quit"]) {
      expect(menu).toContain(label);
    }
    // The first item starts selected.
    expect(menu).toMatch(/▸ Run a task/);

    app.stdin.write("\u001B[B");
    await settle();
    expect(app.lastFrame()).toMatch(/▸ Choose project folder/);
    app.unmount();
  });

  it("opens the task field and types into it", async () => {
    const app = render(React.createElement(App, { initialCwd: process.cwd() }));
    await settle();
    app.stdin.write("\r");
    await settle();
    app.stdin.write("\r");
    await settle();
    expect(app.lastFrame()).toContain("What should the agent do?");

    for (const char of "fix the test") app.stdin.write(char);
    await settle();
    expect(app.lastFrame()).toContain("fix the test");
    app.unmount();
  });

  it("runs a task and streams the agent's output into the pane", async () => {
    const app = render(React.createElement(App, { initialCwd: process.cwd() }));
    await settle();
    app.stdin.write("\r");
    await settle();
    app.stdin.write("\r");
    await settle();
    for (const char of "say ok") app.stdin.write(char);
    app.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const frame = app.lastFrame() ?? "";
    expect(frame).toContain("say ok");
    expect(frame).toContain("fake claude handled");
    expect(frame).toContain("back to the menu");
    app.unmount();
  });

  it("shows the status screen from the menu", async () => {
    const app = render(React.createElement(App, { initialCwd: process.cwd() }));
    await settle();
    app.stdin.write("\r");
    await settle();
    app.stdin.write("\u001B[B");
    app.stdin.write("\u001B[B");
    await settle();
    app.stdin.write("\r");
    await settle();
    expect(app.lastFrame()).toContain("BATON STATUS");
    app.unmount();
  });
});
