import React from "react";
import { render } from "ink-testing-library";
import stripAnsi from "strip-ansi";
import { App } from "/Users/macbook/Downloads/baton/src/ui/shell/app.js";

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const cwd = "/private/tmp/claude-501/-Users-macbook/cd106bd1-ab9f-432d-aef2-3274b91b14b5/scratchpad/slash";
process.env.BATON_HOME = cwd + "/.home";
process.env.BATON_TEST_FAKE = "1";

const commands = process.argv.slice(2);
const app = render(React.createElement(App, { initialCwd: cwd, version: "0.1.0" }));
await settle();
for (const cmd of commands) {
  for (const ch of cmd) app.stdin.write(ch);
  await settle(120);
  app.stdin.write("\r");
  await settle(900);
}
console.log(stripAnsi(app.frames.join("\n")).split("\n").filter((l) => l.trim() !== "").slice(-24).join("\n"));
app.unmount();
