import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RELAY_PREAMBLE } from "./handoff.js";
import { pickNextAgent, runTask, type TaskConfig, type TaskDeps } from "./failover.js";
import { SessionStore } from "./session-store.js";
import type { AgentId, DetectResult } from "./types.js";
import { UsageStore } from "./usage-store.js";
import { RunRenderer } from "../ui/run-renderer.js";
import {
  createFakeAdapter,
  errorScript,
  limitScript,
  okScript,
  type FakeAdapter,
} from "../test-utils/fake-adapter.js";

const dirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const FIXED_NOW = new Date("2026-08-24T18:00:00.000Z");

interface Harness {
  deps: TaskDeps;
  config: TaskConfig;
  adapters: Record<AgentId, FakeAdapter>;
  cwd: string;
  usage: UsageStore;
  store: SessionStore;
}

async function harness(options: {
  scripts: Partial<Record<AgentId, ReturnType<typeof okScript>[]>>;
  detect?: Partial<Record<AgentId, Partial<DetectResult>>>;
  config?: Partial<TaskConfig>;
  onRun?: (agent: AgentId, cwd: string) => unknown;
}): Promise<Harness> {
  const cwd = tempDir("baton-relay-");
  const home = tempDir("baton-home-");
  const store = await SessionStore.load(cwd);
  const usage = await UsageStore.load(home);

  const adapters = {} as Record<AgentId, FakeAdapter>;
  for (const id of ["claude", "codex", "gemini"] as AgentId[]) {
    adapters[id] = createFakeAdapter(id, options.scripts[id] ?? [okScript(`${id} finished`)], {
      ...(options.detect?.[id] !== undefined ? { detect: options.detect[id] } : {}),
      ...(options.onRun !== undefined ? { onRun: () => options.onRun?.(id, cwd) } : {}),
    });
  }

  const deps: TaskDeps = {
    cwd,
    renderer: new RunRenderer({ quiet: true }),
    store,
    usage,
    getAdapter: (id) => adapters[id],
    detect: (id) => adapters[id].detect(),
    now: () => FIXED_NOW,
  };
  const config: TaskConfig = {
    chain: ["claude", "codex", "gemini"],
    maxRelays: 2,
    cooldownMinutes: 30,
    permissionLevel: "safe",
    ...options.config,
  };
  return { deps, config, adapters, cwd, usage, store };
}

describe("the relay", () => {
  it("hands the task to the next agent with the handoff preamble", async () => {
    const h = await harness({
      scripts: {
        claude: [limitScript("usage limit reached", "resets 19:00")],
        codex: [okScript("picked it up and finished")],
      },
    });
    const result = await runTask("fix the flaky auth test", "claude", h.deps, h.config);

    expect(result.status).toBe("done");
    expect(result.relays).toBe(1);
    expect(h.adapters.codex.calls).toHaveLength(1);
    const relayPrompt = h.adapters.codex.calls[0]?.request.prompt ?? "";
    expect(relayPrompt.startsWith(RELAY_PREAMBLE)).toBe(true);
    expect(relayPrompt).toContain("fix the flaky auth test");
    // The first agent's prompt is the bare task — no preamble on a fresh run.
    expect(h.adapters.claude.calls[0]?.request.prompt).toBe("fix the flaky auth test");
  });

  it("writes HANDOFF.md BEFORE spawning the next agent", async () => {
    const seen: { agent: AgentId; handoffExists: boolean; content: string }[] = [];
    const h = await harness({
      scripts: {
        claude: [limitScript("usage limit reached")],
        codex: [okScript("done")],
      },
      onRun: (agent, cwd) => {
        const file = path.join(cwd, "HANDOFF.md");
        const exists = existsSync(file);
        seen.push({
          agent,
          handoffExists: exists,
          content: exists ? readFileSync(file, "utf8") : "",
        });
        return undefined;
      },
    });
    await runTask("migrate the database layer", "claude", h.deps, h.config);

    expect(seen[0]).toMatchObject({ agent: "claude", handoffExists: false });
    expect(seen[1]?.agent).toBe("codex");
    expect(seen[1]?.handoffExists).toBe(true);
    expect(seen[1]?.content).toContain("migrate the database layer");
    expect(seen[1]?.content).toContain("- Previous agent: claude (stopped: usage limit)");
  });

  it("persists the partial turn with endedBy:limit even when the relay then fails", async () => {
    const h = await harness({
      scripts: {
        claude: [limitScript("usage limit reached")],
        codex: [errorScript("the workspace is in a broken state")],
      },
    });
    const result = await runTask("do the thing", "claude", h.deps, h.config);

    expect(result.status).toBe("error");
    const turns = h.store.session.turns;
    expect(turns[0]).toMatchObject({ agent: "claude", endedBy: "limit" });
    expect(turns[1]).toMatchObject({ agent: "codex", endedBy: "error" });
    expect(h.store.session.limitedAgents).toEqual(["claude"]);
  });

  it("honours maxRelays", async () => {
    const h = await harness({
      scripts: {
        claude: [limitScript("usage limit reached")],
        codex: [limitScript("usage limit reached")],
        gemini: [limitScript("usage limit reached")],
      },
      config: { maxRelays: 1 },
    });
    const result = await runTask("keep going", "claude", h.deps, h.config);

    expect(result.status).toBe("exhausted");
    expect(result.relays).toBe(1);
    expect(h.adapters.gemini.calls).toHaveLength(0);
  });

  it("never relays back to an agent that already hit its limit for this task", async () => {
    const h = await harness({
      scripts: {
        claude: [limitScript("usage limit reached")],
        codex: [limitScript("usage limit reached")],
        gemini: [okScript("finished it")],
      },
      config: { maxRelays: 3 },
    });
    const result = await runTask("long task", "claude", h.deps, h.config);

    expect(result.status).toBe("done");
    expect(h.adapters.claude.calls).toHaveLength(1);
    expect(h.adapters.codex.calls).toHaveLength(1);
    expect(h.adapters.gemini.calls).toHaveLength(1);
  });

  it("skips an agent that is cooling down from an earlier session", async () => {
    const h = await harness({
      scripts: {
        claude: [limitScript("usage limit reached")],
        codex: [okScript("should not run")],
        gemini: [okScript("gemini finished")],
      },
    });
    h.usage.recordLimit({
      ts: new Date(FIXED_NOW.getTime() - 5 * 60_000).toISOString(),
      agent: "codex",
      project: h.cwd,
      resetHint: "resets 20:00",
    });

    const result = await runTask("something", "claude", h.deps, h.config);
    expect(result.status).toBe("done");
    expect(h.adapters.codex.calls).toHaveLength(0);
    expect(h.adapters.gemini.calls).toHaveLength(1);
    expect(result.blocked.find((b) => b.agent === "codex")?.reason).toBe("resets 20:00");
  });

  it("skips agents that are not installed or not signed in", async () => {
    const h = await harness({
      scripts: {
        claude: [limitScript("usage limit reached")],
        codex: [okScript("should not run")],
        gemini: [okScript("gemini finished")],
      },
      detect: { codex: { verdict: "not_installed", installed: false } },
    });
    const result = await runTask("something", "claude", h.deps, h.config);
    expect(result.status).toBe("done");
    expect(h.adapters.codex.calls).toHaveLength(0);
    expect(result.blocked.find((b) => b.agent === "codex")?.reason).toBe("not installed");
  });

  it("stops with every reason listed when no agent is left", async () => {
    const h = await harness({
      scripts: { claude: [limitScript("usage limit reached")] },
      detect: {
        codex: { verdict: "not_installed", installed: false },
        gemini: { verdict: "auth" },
      },
    });
    const result = await runTask("nowhere to go", "claude", h.deps, h.config);

    expect(result.status).toBe("exhausted");
    expect(result.relays).toBe(0);
    expect(result.blocked.map((b) => b.reason).sort()).toEqual([
      "not installed",
      "not signed in",
    ]);
  });

  it("does not relay on an unknown error by default, but does with --relay-on-error", async () => {
    const strict = await harness({
      scripts: { claude: [errorScript("TypeError: boom")], codex: [okScript("rescued")] },
    });
    const strictResult = await runTask("task", "claude", strict.deps, strict.config);
    expect(strictResult.status).toBe("error");
    expect(strict.adapters.codex.calls).toHaveLength(0);

    const lenient = await harness({
      scripts: { claude: [errorScript("TypeError: boom")], codex: [okScript("rescued")] },
      config: { relayOnError: true },
    });
    const lenientResult = await runTask("task", "claude", lenient.deps, lenient.config);
    expect(lenientResult.status).toBe("done");
    expect(lenient.adapters.codex.calls).toHaveLength(1);
  });

  it("records the limit in the cooldown ledger with its exact reset time", async () => {
    const h = await harness({
      scripts: {
        claude: [limitScript("rate_limit_event: rejected (five_hour) resetsAt=1787619600", "resets 01:00")],
        codex: [okScript("done")],
      },
    });
    await runTask("task", "claude", h.deps, h.config);

    const record = h.usage.lastLimit("claude");
    expect(record?.resetsAt).toBe(1787619600);
    expect(record?.resetHint).toBe("resets 01:00");
    expect(h.usage.cooldown("claude", 30, FIXED_NOW).cooling).toBe(true);
  });
});

describe("pickNextAgent", () => {
  const always = async (): Promise<{ ok: boolean; reason: string }> => ({ ok: true, reason: "ready" });

  it("prefers the agent after the current one in the chain", async () => {
    const picked = await pickNextAgent({
      chain: ["claude", "codex", "gemini"],
      current: "claude",
      alreadyLimited: [],
      isAvailable: always,
    });
    expect(picked.agent).toBe("codex");
  });

  it("wraps around so a free chain head is still used", async () => {
    const picked = await pickNextAgent({
      chain: ["claude", "codex", "gemini"],
      current: "gemini",
      alreadyLimited: [],
      isAvailable: always,
    });
    expect(picked.agent).toBe("claude");
  });

  it("returns nothing when every candidate is blocked", async () => {
    const picked = await pickNextAgent({
      chain: ["claude", "codex"],
      current: "claude",
      alreadyLimited: ["codex"],
      isAvailable: always,
    });
    expect(picked.agent).toBeUndefined();
    expect(picked.blocked).toEqual([
      { agent: "codex", reason: "already hit its limit for this task" },
    ]);
  });
});
