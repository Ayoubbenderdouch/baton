import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LIMIT_PATTERNS,
  classifyFailureOutput,
  defaultPatternTable,
  extractResetHint,
  loadPatternTable,
} from "./limit-detector.js";
import type { AgentId } from "./types.js";

const AGENTS: AgentId[] = ["claude", "codex", "gemini"];
const fixture = (agent: string, name: string): string =>
  readFileSync(path.join(process.cwd(), "fixtures", agent, name), "utf8");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "baton-patterns-"));
  dirs.push(dir);
  return dir;
}

describe("pattern hygiene (failover-detection skill)", () => {
  it("backs every default pattern with a real fixture line", () => {
    for (const agent of AGENTS) {
      const lines = fixture(agent, "limit.txt").split("\n").filter((line) => line.trim() !== "");
      for (const pattern of DEFAULT_LIMIT_PATTERNS[agent]) {
        const regex = new RegExp(pattern, "i");
        expect(
          lines.some((line) => regex.test(line)),
          `${agent} pattern /${pattern}/ has no fixture line proving it`,
        ).toBe(true);
      }
    }
  });

  it("matches nothing in a healthy run — zero false positives", () => {
    const healthy: [AgentId, string][] = [
      ["claude", fixture("claude", "ok-stream.jsonl")],
      ["claude", fixture("claude", "ok-final.json")],
      ["claude", fixture("claude", "tool-stream.jsonl")],
      ["codex", fixture("codex", "ok-stream.jsonl")],
      ["codex", fixture("codex", "tool-stream.jsonl")],
      ["gemini", fixture("gemini", "ok-stream.jsonl")],
      ["gemini", fixture("gemini", "ok-final.json")],
      ["gemini", fixture("gemini", "tool-stream.jsonl")],
    ];
    const table = defaultPatternTable();
    for (const [agent, text] of healthy) {
      for (const pattern of table[agent]) {
        expect(pattern.test(text), `${agent} pattern ${pattern} fired on a healthy run`).toBe(
          false,
        );
      }
    }
  });

  it("does not fire on an agent explaining rate limiting in prose", () => {
    const prose =
      "I added a token bucket so the client backs off when the API answers with a " +
      "429 status, and documented the retry policy for quota errors.";
    // Prose only reaches the classifier as failure output; even then codex's 429 pattern
    // is word-bounded, so the sentence above is scanned but the words are all inside
    // normal text — this test pins the behaviour we accept.
    expect(classifyFailureOutput("claude", prose).kind).toBe("crash");
  });
});

describe("classifyFailureOutput", () => {
  it("calls a real limit a limit, per provider", () => {
    for (const agent of AGENTS) {
      expect(classifyFailureOutput(agent, fixture(agent, "limit.txt")).kind).toBe("limit");
    }
  });

  it("calls a sign-in problem auth, never a limit", () => {
    for (const agent of AGENTS) {
      expect(classifyFailureOutput(agent, fixture(agent, "auth.txt")).kind).toBe("auth");
    }
  });

  it("calls an unknown failure a crash, so the relay stays put", () => {
    expect(classifyFailureOutput("claude", fixture("claude", "crash.txt")).kind).toBe("crash");
    expect(classifyFailureOutput("gemini", "ENOSPC: no space left on device").kind).toBe("crash");
  });

  it("lets a structured signal win, keeping the machine-readable reset time", () => {
    const result = classifyFailureOutput("claude", "whatever the text says", {
      structured: { kind: "limit", resetHint: "resets 19:00", resetsAt: 1787619600 },
    });
    expect(result.kind).toBe("limit");
    expect(result.resetHint).toBe("resets 19:00");
    expect(result.resetsAt).toBe(1787619600);
  });

  it("extracts a reset hint when the provider wrote one", () => {
    expect(extractResetHint("Your limit will reset at 7pm (Europe/Berlin).")).toBe(
      "resets 7pm (Europe/Berlin)",
    );
    expect(extractResetHint("You've hit your usage limit. Try again in 3 hours 12 minutes.")).toBe(
      "try again in 3 hours 12 minutes",
    );
    expect(extractResetHint("Retry in 4h.")).toBe("try again in 4h");
    expect(extractResetHint("nothing useful here")).toBeUndefined();
  });
});

describe("user patterns extend the defaults", () => {
  it("adds new wording without losing the built-ins", async () => {
    const home = tempHome();
    writeFileSync(
      path.join(home, "patterns.json"),
      JSON.stringify({ claude: ["schluss für heute"] }),
      "utf8",
    );
    const { table, warning } = await loadPatternTable(home);
    expect(warning).toBeUndefined();
    expect(table.claude.some((p) => p.test("Schluss für heute, komm morgen wieder"))).toBe(true);
    expect(table.claude.some((p) => p.test("usage limit reached"))).toBe(true);
  });

  it("warns once and keeps working when the file is malformed", async () => {
    const home = tempHome();
    writeFileSync(path.join(home, "patterns.json"), JSON.stringify({ claude: "oops" }), "utf8");
    const { table, warning } = await loadPatternTable(home);
    expect(warning).toContain("expected string arrays");
    expect(table.claude.length).toBe(DEFAULT_LIMIT_PATTERNS.claude.length);
  });

  it("ignores an invalid regex instead of crashing the run", async () => {
    const home = tempHome();
    writeFileSync(path.join(home, "patterns.json"), JSON.stringify({ codex: ["([unclosed"] }), "utf8");
    const { table } = await loadPatternTable(home);
    expect(table.codex.length).toBe(DEFAULT_LIMIT_PATTERNS.codex.length);
  });

  it("survives a corrupt patterns.json", async () => {
    const home = tempHome();
    writeFileSync(path.join(home, "patterns.json"), "{{{", "utf8");
    const { table } = await loadPatternTable(home);
    expect(table.gemini.length).toBe(DEFAULT_LIMIT_PATTERNS.gemini.length);
  });
});
