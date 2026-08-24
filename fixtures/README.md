# Fixtures — provenance

These files are the project's crown jewels (docs/TESTING.md): every parser branch and
every limit pattern points at one of them. Because honesty about provenance matters more
than a full-looking table, each file says exactly where it came from.

**Captured** = the real bytes a real CLI printed on a real machine, with personal data
removed (home paths → `/home/user`, project path → `/work/project`, session/thread ids →
fixed fake ids, the local plugin/MCP/skill inventory stripped from Claude's `init` line).

**Synthesized** = written by hand in the real shape of that provider's output, using the
provider's own documented wording. Nobody exhausted a paid account to produce a fixture,
and no CLI was signed out to capture an auth error.

Captured on 2026-08-24, macOS: claude 2.1.241 · codex-cli 0.147.0 · gemini 0.56.0.

| File | Origin | What it proves |
|---|---|---|
| `claude/ok-final.json` | captured | `--output-format json` envelope: `result`, `session_id`, `usage` |
| `claude/ok-stream.jsonl` | captured | stream-json happy path incl. a `rate_limit_event` with `status: allowed` |
| `claude/tool-stream.jsonl` | captured | `tool_use` / `tool_result` blocks and multiple assistant texts |
| `claude/crash.json` + `crash.txt` | captured (bogus `--model`) | `is_error: true`, `terminal_reason: api_error`, stderr wording |
| `claude/limit-stream.jsonl` | **synthesized** | a blocked `rate_limit_event` plus the limit result envelope |
| `claude/limit.txt` | **synthesized** | the "usage limit reached … resets at" wording the patterns match |
| `claude/auth.txt` | **synthesized** | sign-in wording (never captured — that would mean logging out) |
| `codex/ok-stream.jsonl` | captured | `thread.started` / `turn.started` / `item.completed` / `turn.completed.usage` |
| `codex/tool-stream.jsonl` | captured | `command_execution` items with `aggregated_output` and `exit_code` |
| `codex/turn-failed.jsonl` | captured (bogus `-m`) | the real `turn.failed` + top-level `error` shape |
| `codex/git-repo-required.txt` | captured | codex refusing to run outside a git repo / trusted dir |
| `codex/limit.jsonl` | **synthesized** | a 429 rate-limit error carried inside `turn.failed` |
| `codex/auth.txt` | **synthesized** | `codex login` wording |
| `gemini/ok-final.json` | captured | `-o json`: `response` + `stats.models.*.tokens` |
| `gemini/ok-stream.jsonl` | captured | `init` / `message` / `result` with `stats.input_tokens` |
| `gemini/tool-stream.jsonl` | captured | `tool_use` / `tool_result` line types |
| `gemini/crash.txt` | captured (bogus `-m`) | `ModelNotFoundError` on stderr with an empty stdout |
| `gemini/trust-error.txt` | captured | the untrusted-folder refusal (exit 55) and its remedy |
| `gemini/limit.jsonl` | **synthesized** | `429 RESOURCE_EXHAUSTED` in the stream + error result |
| `gemini/auth.txt` | **synthesized** | Google sign-in wording |
| `unicode-task.txt` | written | Arabic + emoji task text pushed through the whole pipeline |
| `local-history/claude/**` | **synthesized** | `--deep` reading of Claude's local JSONL transcripts, including junk lines it must skip |
| `local-history/codex/**` | **synthesized** | `--deep` reading of Codex session logs |
| `fake-cli/emit.mjs` | tool | replays any fixture as a fake provider CLI (CRLF, exit codes, stderr, hang) |

The `local-history` fixtures are synthesized deliberately: the real directories live in
the user's home, and reading a personal transcript to commit it as a fixture is not
something this project does. `--deep` points at those directories at runtime only, and
`BATON_CLAUDE_HOME` / `BATON_CODEX_HOME` redirect it to a fixture tree for tests.

## Refreshing a synthesized fixture with the real thing

When someone actually hits a usage limit while running Baton, capture the raw output
(`baton run --verbose` prints every provider line), sanitize it, replace the synthesized
file, and keep the test green. That is the moment the limit patterns stop being
best-effort. Until then, `docs/FAILOVER.md`'s "MUST be refreshed from real captures"
requirement is **open**, and it is tracked in the README's known-limitations section.
