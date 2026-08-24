# Baton — Adapter Specifications

One adapter per provider, in `src/adapters/<id>/`. Each adapter spawns the **official
CLI in its documented headless / non-interactive mode** and normalizes output into
`AgentEvent`s (see ARCHITECTURE.md).

> ⚠️ **Verify at build time.** These flags were verified against docs and current
> references as of August 2026, but all three CLIs move fast. Before implementing each
> adapter, run the real `--help` (`claude --help`, `codex exec --help`, `gemini --help`)
> and adjust. If a flag differs, trust the installed binary, update this file, and add a
> fixture capturing the real output shape.

---

## 1. ClaudeAdapter (Claude Code — uses the user's Claude subscription)

**Invocation (streaming):**

```
claude -p "<prompt>" --output-format stream-json --verbose
```

- `-p` / `--print` = non-interactive print mode: runs the full agent loop, prints, exits.
- `--output-format` takes `text` | `json` | `stream-json`.
  - `json`: one final envelope containing `result`, `session_id`, `is_error`,
    `num_turns`, duration and cost metadata. Easiest for v1 — acceptable to start with.
  - `stream-json`: newline-delimited JSON events as they happen; **requires `--verbose`**;
    add `--include-partial-messages` only if token-level deltas are wanted for the live UI.
- Permissions (map from Baton's `permissionLevel`):
  - `safe` → `--allowedTools "Read,Grep,Glob,Bash(git diff:*),Bash(git status:*)"`
  - `auto` → `--permission-mode acceptEdits` plus a scoped `--allowedTools` list.
    Never default to `--dangerously-skip-permissions`; expose it only behind an explicit
    `--unsafe` Baton flag with a red warning.
- Cap runaway runs: `--max-turns <n>` (config, default 30).
- **Resume:** capture `session_id` from output; native continuation is
  `claude --resume <session_id> -p "<follow-up>"` (also `--continue` for most recent).
  Prefer native resume for same-agent `baton continue`; use HANDOFF preamble when
  crossing agents.

**Parsing:** each stream-json line has a `type` field (init/system, assistant, tool
events, final `result`). Map assistant text → `text` events, tool events → `tool`,
final result → `done` with `resultText` and `sessionRef`. Non-zero exit or
`is_error: true` → classify via LimitDetector before emitting `error`.

**Usage source:** the final result envelope (turns, usage metadata) — record what's
present, leave absent fields undefined. Optional deeper history: Claude Code writes
local JSONL transcripts under `~/.claude/projects/` (this is what tools like ccusage
read). Parsing that is milestone M7's optional enhancement, strictly read-only.

---

## 2. CodexAdapter (Codex CLI — uses the user's ChatGPT subscription)

**Invocation (streaming):**

```
codex exec --json "<prompt>"
```

- `codex exec` (alias `codex e`) = non-interactive mode; never prompts for approval;
  streams progress to **stderr**, final message to **stdout** (plain mode).
- `--json` switches stdout to a JSONL event stream: `turn.started`,
  `turn.completed` (includes **token usage**), `turn.failed` (includes error details),
  `item.started/updated/completed`; an `assistant_message` item carries the final text.
- Useful extras: `-o <file>` / `--output-last-message` writes the final message to a
  file; `--output-schema <schema.json>` enforces structured final output.
- Sandbox/permissions mapping:
  - `safe` → `--sandbox read-only`
  - `auto` → `--sandbox workspace-write` (or `--full-auto`)
  - Never use `--dangerously-bypass-approvals-and-sandbox` / `--yolo` except behind
    Baton's explicit `--unsafe`.
- **Resume:** `codex exec resume --last "<follow-up>"` continues the most recent
  non-interactive session (or `codex exec resume <thread_id> …`). Capture the thread id
  from the event stream when present.

**Parsing:** JSONL per line. `item.*` with agent message content → `text`;
`turn.completed.usage` → `usage`; `turn.failed` → LimitDetector classification.
Remember stderr carries progress text in non-`--json` mode — with `--json`, treat
stderr as log noise but still scan it in the LimitDetector.

**Usage source:** `turn.completed` token usage — the most reliable of the three.
Codex home is `~/.codex/` (config.toml, session logs) — read-only, optional history.

---

## 3. GeminiAdapter (Gemini CLI — uses the user's Google account)

**Invocation (streaming):**

```
gemini -p "<prompt>" --output-format stream-json --approval-mode <mode>
```

- `-p` / `--prompt` = non-interactive mode. (`-i` / `--prompt-interactive` is the
  interactive variant — do not use it.)
- `--output-format` takes `text` | `json` | `stream-json`:
  - `json`: single object `{ response, stats, error }` where `stats.models` has
    per-model token counts (prompt/response/cached/total) and `stats.tools` has tool
    call counts. Great for usage tracking.
  - `stream-json`: JSONL events for live rendering.
- Approval mapping:
  - `safe` → default approval mode (read-oriented prompt design; Gemini may still plan)
  - `auto` → `--approval-mode yolo` (or `-y` / `--yolo`) — auto-approves tool calls.
  - Known quirk: even in yolo, Gemini sometimes ends a turn asking "does this plan sound
    good?" instead of acting. Counter it in the prompt preamble: *"Non-interactive run.
    Never ask for confirmation; proceed and report."* Add a fixture for this case.
- **Resume:** a session resume option exists but has been unstable across versions —
  treat Gemini as **stateless** in v1 and always rely on the HANDOFF preamble for
  continuity. Revisit after verifying the installed version.

**Parsing:** in `json` mode, `response` → final `text` + `done`; `stats.models.*.tokens`
→ `usage`; `error` object → LimitDetector. In `stream-json`, map message deltas to
`text` events.

**Usage source:** `stats` block of the json output.

---

## Shared adapter rules

1. **Spawn via execa with an args array** — never a shell string (see CROSS-PLATFORM.md).
2. **Auth probe in `detect()`:** run the cheapest possible invocation (e.g. `--version`,
   then a 1-token no-op prompt only if needed) with a short timeout; classify
   `not_installed` (ENOENT) vs `auth` (login-related stderr) vs `ok`. Never attempt to
   fix auth — print the provider's own login command as the remedy.
3. **Timeout + heartbeat:** config `runTimeoutMs` (default 20 min). If no event for
   `stallMs` (default 120s), surface a "still working…" note; never silently hang.
4. **Every parser is fixture-driven:** for each provider keep
   `fixtures/<id>/ok-stream.jsonl`, `ok-final.json`, `limit.txt`, `auth-error.txt`,
   `crash.txt` captured from real runs, and unit-test the mapping (see TESTING.md).
5. **Model selection is the provider's business.** Baton does not pass model flags in v1
   except via passthrough config (`agents.<id>.extraArgs: string[]`) so power users can
   pin models without Baton hardcoding names that go stale.
