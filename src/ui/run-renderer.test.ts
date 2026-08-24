import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunRenderer } from "./run-renderer.js";

let written: string[] = [];
beforeEach(() => {
  written = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
});
afterEach(() => vi.restoreAllMocks());

// CI runners enable colour (FORCE_COLOR), a piped local shell does not — compare the
// visible text either way.
// eslint-disable-next-line no-control-regex -- stripping ANSI is the point here
const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");

const lines = (): string[] =>
  stripAnsi(written.join(""))
    .split("\n")
    .filter((line) => line !== "");

describe("streamed text rendering", () => {
  it("joins fragments that split mid-sentence into whole lines", () => {
    const renderer = new RunRenderer({ quiet: true });
    // Exactly how gemini chunks it: one sentence across three delta events.
    renderer.event({ type: "text", text: "I have created" });
    renderer.event({ type: "text", text: " the file hello.txt with" });
    renderer.event({ type: "text", text: " exactly the word hello.\n" });
    expect(lines()).toEqual(["baton: I have created the file hello.txt with exactly the word hello."]);
  });

  it("keeps real line breaks as separate lines", () => {
    const renderer = new RunRenderer({ quiet: true });
    renderer.event({ type: "text", text: "first line\nsecond line\n" });
    expect(lines()).toEqual(["baton: first line", "baton: second line"]);
  });

  it("flushes pending text before a tool line, so nothing is reordered", () => {
    const renderer = new RunRenderer({ quiet: true });
    renderer.event({ type: "text", text: "about to write the file" });
    renderer.event({ type: "tool", name: "write_file", detail: "hello.txt" });
    expect(lines()).toEqual([
      "baton: about to write the file",
      "baton: write_file: hello.txt",
    ]);
  });

  it("flushes text with no trailing newline when the turn ends", () => {
    const renderer = new RunRenderer({ quiet: true });
    renderer.event({ type: "text", text: "ok" });
    renderer.event({ type: "done", ok: true, resultText: "ok" });
    expect(lines()).toEqual(["baton: ok"]);
  });

  it("drops empty chunks instead of printing blank lines", () => {
    const renderer = new RunRenderer({ quiet: true });
    renderer.event({ type: "text", text: "\n\n   \n" });
    renderer.stop();
    expect(lines()).toEqual([]);
  });
});
