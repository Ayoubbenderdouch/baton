import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type BatonConfig } from "./config.js";
import { routeTask } from "./router.js";
import type { AgentId } from "./types.js";

const allReady = (): { ok: boolean; reason: string } => ({ ok: true, reason: "ready" });
const config: BatonConfig = DEFAULT_CONFIG;

interface Case {
  name: string;
  task: string;
  role?: string;
  agentFlag?: string;
  attachedContextChars?: number;
  expected: AgentId;
  reasonContains: string;
}

// Table-driven, per docs/MILESTONES.md M6 (>= 15 cases).
const cases: Case[] = [
  {
    name: "explicit flag always wins",
    task: "summarize the repo",
    agentFlag: "codex",
    expected: "codex",
    reasonContains: "--agent",
  },
  {
    name: "role architect maps to claude",
    task: "anything at all",
    role: "architect",
    expected: "claude",
    reasonContains: 'role "architect"',
  },
  {
    name: "role implement maps to codex",
    task: "anything at all",
    role: "implement",
    expected: "codex",
    reasonContains: 'role "implement"',
  },
  {
    name: "role quick protects the paid limits",
    task: "what does this flag do",
    role: "quick",
    expected: "gemini",
    reasonContains: 'role "quick"',
  },
  {
    name: "debugging goes to claude",
    task: "debug the failing checkout flow",
    expected: "claude",
    reasonContains: 'keyword "debug"',
  },
  {
    name: "why-is questions go to claude",
    task: "why is the queue draining twice",
    expected: "claude",
    reasonContains: '"why is"',
  },
  {
    name: "race conditions go to claude",
    task: "there is a race condition in the worker pool",
    expected: "claude",
    reasonContains: "race condition",
  },
  {
    name: "architecture work goes to claude",
    task: "design the architecture for the billing service",
    expected: "claude",
    reasonContains: "architecture",
  },
  {
    name: "summarising goes to gemini",
    task: "summarize what this service does",
    expected: "gemini",
    reasonContains: "summarize",
  },
  {
    name: "British spelling also goes to gemini",
    task: "summarise the migration history",
    expected: "gemini",
    reasonContains: "summarise",
  },
  {
    name: "reviews go to gemini",
    task: "review the pull request diff",
    expected: "gemini",
    reasonContains: "review",
  },
  {
    name: "implementation goes to codex",
    task: "implement the CSV export endpoint",
    expected: "codex",
    reasonContains: "implement",
  },
  {
    name: "test writing goes to codex",
    task: "write tests for the parser",
    expected: "codex",
    reasonContains: "write tests",
  },
  {
    name: "renames go to codex",
    task: "rename userId to accountId everywhere",
    expected: "codex",
    reasonContains: "rename",
  },
  {
    name: "very long prompts go to gemini",
    task: `refactor ${"x".repeat(6100)}`,
    expected: "gemini",
    reasonContains: "prompt over 6000 chars",
  },
  {
    name: "a lot of attached context goes to gemini",
    task: "look at this",
    attachedContextChars: 25_000,
    expected: "gemini",
    reasonContains: "attached context over 20000 chars",
  },
  {
    name: "a task with no signal falls to the chain head",
    task: "do the needful",
    expected: "claude",
    reasonContains: "chain head",
  },
  {
    name: "earlier rules win over later ones",
    task: "debug why the summarize endpoint is slow",
    expected: "claude",
    reasonContains: 'keyword "debug"',
  },
];

describe("routeTask (table-driven)", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const decision = routeTask(
        {
          task: testCase.task,
          ...(testCase.role !== undefined ? { role: testCase.role } : {}),
          ...(testCase.agentFlag !== undefined ? { agentFlag: testCase.agentFlag } : {}),
          ...(testCase.attachedContextChars !== undefined
            ? { attachedContextChars: testCase.attachedContextChars }
            : {}),
        },
        config,
        allReady,
      );
      expect(decision.agent).toBe(testCase.expected);
      expect(decision.reason).toContain(testCase.reasonContains);
    });
  }
});

describe("routing in other languages", () => {
  it("matches Arabic keywords a user added to their config", () => {
    const arabic: BatonConfig = {
      ...config,
      rules: [{ match: { keywordsAny: ["اشرح", "لخص"] }, agent: "gemini" }, ...config.rules],
    };
    const decision = routeTask({ task: "لخص لي هذا المستودع" }, arabic, allReady);
    expect(decision.agent).toBe("gemini");
    expect(decision.reason).toContain("لخص");
  });

  it("matches regardless of case", () => {
    expect(routeTask({ task: "DEBUG the parser" }, config, allReady).agent).toBe("claude");
  });
});

describe("availability filter", () => {
  it("falls through to the next candidate and says who was skipped", () => {
    const decision = routeTask({ task: "debug the flaky test" }, config, (agent) =>
      agent === "claude" ? { ok: false, reason: "cooling down (resets 19:00)" } : { ok: true, reason: "ready" },
    );
    expect(decision.agent).toBe("codex");
    expect(decision.skipped).toEqual([{ agent: "claude", reason: "cooling down (resets 19:00)" }]);
  });

  it("obeys --agent even for a cooling agent", () => {
    const decision = routeTask({ task: "x", agentFlag: "claude" }, config, () => ({
      ok: false,
      reason: "cooling down",
    }));
    expect(decision.agent).toBe("claude");
  });

  it("reports no agent when everything is blocked", () => {
    const decision = routeTask({ task: "x" }, config, () => ({ ok: false, reason: "not installed" }));
    expect(decision.agent).toBeUndefined();
    expect(decision.reason).toBe("no agent available");
    expect(decision.skipped.length).toBeGreaterThan(0);
  });

  it("rejects an unknown role with the list of known ones", () => {
    const decision = routeTask({ task: "x", role: "wizard" }, config, allReady);
    expect(decision.agent).toBeUndefined();
    expect(decision.reason).toContain("architect");
  });

  it("rejects an unknown agent flag", () => {
    const decision = routeTask({ task: "x", agentFlag: "kimi" }, config, allReady);
    expect(decision.agent).toBeUndefined();
    expect(decision.reason).toContain('unknown agent "kimi"');
  });
});
