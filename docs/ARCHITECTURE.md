# Baton — Architecture

Baton is a **subscription-native multi-agent orchestrator**. It never talks to any AI
provider over the network. It only spawns the **official CLIs** already installed and
authenticated on the user's machine (Claude Code, Codex CLI, Gemini CLI) as child
processes, coordinates them, and carries context between them.

## The one rule that defines everything

> **Baton never reads, stores, transmits, or touches credentials of any provider.**
> No OAuth tokens, no API keys, no session cookies, no auth env vars, no edits to
> `~/.claude`, `~/.codex`, or `~/.gemini` config. Authentication belongs 100% to the
> official CLIs. Baton is a remote control, not a proxy.

Every design decision below follows from this rule. If a feature would require breaking
it, the feature is rejected.

## Components

```
┌─────────────────────────────────────────────────────────┐
│  CLI layer (commander)                                  │
│  baton run | continue | status | doctor | agents |      │
│  handoff | config | init                                │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────┐   ┌──────────────────────┐
│  Orchestrator               │──▶│  Router              │
│  run loop, relay logic      │   │  role/keyword/size   │
└───────┬───────────┬─────────┘   │  rules → agent choice│
        │           │             └──────────────────────┘
        │   ┌───────▼─────────┐   ┌──────────────────────┐
        │   │  Failover engine│──▶│  LimitDetector       │
        │   │  chain + retry  │   │  pattern tables      │
        │   └───────┬─────────┘   └──────────────────────┘
        │           │
┌───────▼───────────▼─────────────────────────────────────┐
│  Adapter registry                                       │
│  ClaudeAdapter │ CodexAdapter │ GeminiAdapter │ (more)  │
│  spawn official CLI headless, parse structured stream   │
└───────┬─────────────────────────────────────────────────┘
        │
┌───────▼─────────────────────┐   ┌──────────────────────┐
│  SessionStore (.baton/)     │──▶│  HandoffWriter       │
│  turns, files touched, meta │   │  HANDOFF.md builder  │
└─────────────────────────────┘   └──────────────────────┘
                 │
        ┌────────▼─────────┐
        │  UsageTracker    │  → `baton status`
        └──────────────────┘
```

### Adapter (the contract every provider implements)

```ts
export interface AgentAdapter {
  id: AgentId;                        // "claude" | "codex" | "gemini"
  displayName: string;                // shown in UI with the agent badge
  detect(): Promise<DetectResult>;    // installed? version? auth probe result?
  run(req: RunRequest): RunHandle;    // spawn headless, stream events
  buildResumeArgs?(sessionRef: string, prompt: string): string[];
}

export interface RunRequest {
  prompt: string;                     // final prompt incl. handoff preamble if relaying
  cwd: string;
  permissionLevel: "safe" | "auto";   // maps to each CLI's own flags (see ADAPTERS.md)
  sessionRef?: string;                // provider-native session id to resume, if any
}

export interface RunHandle {
  events: AsyncIterable<AgentEvent>;  // normalized event stream (below)
  cancel(): Promise<void>;            // cross-platform tree kill
}

export type AgentEvent =
  | { type: "start";  sessionRef?: string }
  | { type: "text";   text: string }                       // assistant output delta/chunk
  | { type: "tool";   name: string; detail?: string }      // tool call happening
  | { type: "usage";  inputTokens?: number; outputTokens?: number }
  | { type: "limit";  raw: string; resetHint?: string }    // rate/usage limit detected
  | { type: "error";  kind: "auth" | "not_installed" | "crash" | "unknown"; raw: string }
  | { type: "done";   ok: boolean; resultText: string; sessionRef?: string };
```

Adapters translate each provider's structured output (JSON / JSONL) into this stream.
The orchestrator, failover engine, renderer, and usage tracker only ever consume
`AgentEvent` — they never see provider-specific formats. This is what makes adding a
4th provider (Kimi, Qwen, etc.) a one-folder job later.

### Orchestrator run loop (happy path + relay)

1. Resolve agent: `--agent` flag → else Router decision → else default chain head.
2. Load rolling context from `.baton/session.json`; if this is a relay or `baton continue`,
   prepend the handoff preamble (see FAILOVER.md).
3. `adapter.run()` → render events live (see UX-SPEC.md) → append a Turn to the store.
4. On `limit` event (or `error` classified as limit): FailoverEngine picks the next agent
   in the chain that is detected + not cooling down → generate `HANDOFF.md` → re-dispatch
   the same task with the handoff preamble → announce the relay clearly in the UI.
5. On `done`: persist turn summary, files changed (`git diff --name-only` before/after),
   usage numbers, provider session ref (for native resume next time).

### State on disk

```
<project>/.baton/
  session.json        # array of Turn records + rolling summary (source of truth)
  HANDOFF.md          # regenerated file, human-readable, also read by agents
  config.json         # per-project overrides (chain, roles, permissionLevel)

~/.baton/             # or %USERPROFILE%\.baton on Windows — always via os.homedir()
  config.json         # global defaults
  patterns.json       # user-extendable limit/error regex tables (defaults shipped in-code)
  usage.json          # aggregated usage records for `baton status`
```

`Turn` record (keep it small — this is not a transcript archive):

```ts
interface Turn {
  ts: string;                // ISO
  agent: AgentId;
  promptPreview: string;     // first ~200 chars
  resultSummary: string;     // adapter's final resultText, truncated ~500 chars
  filesChanged: string[];
  usage?: { inputTokens?: number; outputTokens?: number };
  sessionRef?: string;       // provider-native id (claude session_id, codex thread id…)
  endedBy: "done" | "limit" | "error" | "cancel";
}
```

## Tech stack (fixed — do not substitute)

- **Node.js ≥ 22**, **TypeScript strict**, ESM (`"type": "module"`).
  (The doc said ≥20; reality wins per rule 7 — execa 10 declares `engines: node >=22` and
  crashes on Node 20 with `TEXT_ENCODINGS.union is not a function`. Node 20 reached
  end-of-life in April 2026, so requiring 22 costs no supported user anything.)
- **execa** for child processes (see CROSS-PLATFORM.md for the Windows rules).
- **commander** for the CLI surface.
- **picocolors** + **string-width** for terminal output, **ink** + **react** for the
  interactive shell (lazily imported, so `baton run` never loads React).
  `ora` was dropped: the UI overhaul needs one shared 10fps clock for every animated
  element rather than a spinner library with its own timer, so `src/ui/animation.ts`
  replaced it — one dependency fewer for a security-sensitive audience.
- **vitest** for tests. **zod** for config/schema validation.
- Zero telemetry. Zero network calls. `package.json` name: **`baton-ai`**, bin: **`baton`**.

## Non-goals for v1

- No LLM-based task classification (heuristics only — see ROUTING.md).
- No parallel multi-agent execution (Baton is a **relay**, not a swarm — that's the
  differentiator; don't drift into vibe-kanban territory).
- No plugin marketplace. Adapters are in-repo.
- No wrapping of provider auth flows. `baton doctor` tells the user to run
  `claude` / `codex` / `gemini` once themselves to log in.
