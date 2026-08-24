# Baton — Adapter Specifications

One adapter per provider, in `src/adapters/<id>/`. Each adapter spawns the **official
CLI in its documented headless / non-interactive mode** and normalizes output into
`AgentEvent`s (see ARCHITECTURE.md).

> ✅ **Verified 2026-08-24** against claude 2.1.241, codex-cli 0.147.0 and gemini 0.56.0
> on macOS — see `docs/CLI-VERIFICATION.md` for the evidence log and the deltas that were
> folded into this file.
>
> ⚠️ **Verify at build time.** All three CLIs move fast. Before implementing each
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
- ~~Cap runaway runs: `--max-turns <n>`~~ — **removed from Claude Code by 2.1.241**; the
  flag no longer exists. Baton bounds a run with its own `runTimeoutMs` instead, and a
  user who wants a turn cap passes it through `agents.claude.extraArgs`.
- **Resume:** capture `session_id` from output; native continuation is
  `claude --resume <session_id> -p "<follow-up>"` (also `--continue` for most recent).
  Prefer native resume for same-agent `baton continue`; use HANDOFF preamble when
  crossing agents.

**Parsing:** each stream-json line has a `type` field. Verified line types in 2.1.241:
`system` (`subtype: init` carries `session_id` and `cwd`; also `hook_started` /
`hook_response` from the user's own hooks), `assistant` (`message.content[]` with
`{type:"text"}` and `{type:"tool_use", name, input}`), `user` (tool results),
**`rate_limit_event`**, and the final `result` envelope. Map assistant text → `text`,
`tool_use` → `tool`, final result → `done` with `resultText` and `sessionRef`. Unknown
line types must be ignored, never fatal — Claude Code adds types over time.

**`rate_limit_event` (structured limit signal, verified capture):**

```json
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1787619600,
 "rateLimitType":"five_hour","overageStatus":"rejected","isUsingOverage":false}}
```

`status: "allowed"` is the healthy case. A blocked status (rejected / exhausted /
blocked / limit_reached / throttled) is Layer A limit detection for Claude, and
`resetsAt` (unix seconds) gives an exact `resetHint` — far better than regex. An
unrecognised status is deliberately treated as *not* a limit.

**stdin:** the spawned CLI must be handed a closed stdin. With a piped, never-closed
stdin the provider CLIs wait for input (codex prints "Reading additional input from
stdin...") and the run hangs. Baton always passes an explicit (usually empty) stdin.

Non-zero exit or `is_error: true` → classify via LimitDetector before emitting `error`.

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
  - `auto` → `--sandbox workspace-write` (**`--full-auto` is not a flag of `codex exec`
    in 0.147.0** — the sandbox selector is the only knob)
  - Never use `--dangerously-bypass-approvals-and-sandbox` / `--yolo` except behind
    Baton's explicit `--unsafe`.
- **Gate:** outside a git repository codex refuses with *"Not inside a trusted directory
  and --skip-git-repo-check was not specified"* (fixture:
  `fixtures/codex/git-repo-required.txt`). Baton does not pass that flag for the user —
  it prints the remedy and points at `agents.codex.extraArgs`.
- **Resume:** `codex exec resume --last "<follow-up>"` continues the most recent
  non-interactive session (or `codex exec resume <thread_id> …`). Capture the thread id
  from the event stream when present.

**Parsing (verified 0.147.0):** JSONL per line. Real line types seen:
`thread.started` (**carries `thread_id` — the resume handle**), `turn.started`,
`item.started` / `item.completed` with `item.type` in `agent_message` /
`command_execution` (`command`, `aggregated_output`, `exit_code`) / `error`,
`turn.completed` (`usage.input_tokens` / `output_tokens` / `cached_input_tokens`),
`turn.failed` (`error.message` holds the provider's raw JSON error, e.g. a 429), plus a
top-level `error` line that duplicates it. An `item.type: "error"` is often a *recovered*
warning — only `turn.failed` ends a turn. Commands arrive wrapped as
`/bin/zsh -lc '…'`; unwrap for display. Resume is
`codex exec resume [SESSION_ID] [PROMPT]` (id first, then the prompt).
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
- Approval mapping (adjusted — see the note below):
  - `safe` → `--approval-mode plan` (0.56.0's own read-only mode; a stronger guarantee
    than "default", which in a headless run just leaves tool calls unapprovable)
  - `auto` → `--approval-mode auto_edit` (auto-approves edit tools = the analogue of
    Claude's `acceptEdits`). **Not `yolo`:** yolo auto-approves *every* tool call, which
    is precisely the yolo-class mode the project reserves for Baton's explicit
    `--unsafe`. Constraint 5 of the master prompt outranks this file's original mapping.
  - `--unsafe` → `--approval-mode yolo`.
  - Known quirk: even in yolo, Gemini sometimes ends a turn asking "does this plan sound
    good?" instead of acting. Counter it in the prompt preamble: *"Non-interactive run.
    Never ask for confirmation; proceed and report."* Add a fixture for this case.
- **Resume:** a session resume option exists but has been unstable across versions —
  treat Gemini as **stateless** in v1 and always rely on the HANDOFF preamble for
  continuity. Revisit after verifying the installed version.

**Parsing (verified 0.56.0):** in `json` mode the envelope is
`{ session_id, response, stats }`, and per-model tokens are
`stats.models.<model>.tokens.{input, prompt, candidates, total, cached, thoughts, tool}` —
**`prompt` is the input count and `candidates` the output count** (the doc's earlier
`prompt`/`response` naming was wrong). In `stream-json` the line types are `init`
(`session_id`, `model`), `message` (`role`, `content`, `delta` — the user's own message
is echoed back and must be skipped), `tool_use` (`tool_name`, `parameters`),
`tool_result`, and `result` (`status`, `stats.input_tokens` / `output_tokens` /
`total_tokens`). Baton runs stream-json: it carries both the live text and the usage.

**Gate:** in a folder Gemini does not trust, a headless run exits **55** with
*"Gemini CLI is not running in a trusted directory"* (fixture:
`fixtures/gemini/trust-error.txt`). Baton prints that remedy rather than passing
`--skip-trust` on the user's behalf.

**Usage source:** the `result` line in stream-json, `stats` in json mode.

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
