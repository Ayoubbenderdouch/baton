# Baton — Usage tracking & `baton status`

The near-absent feature in every competitor: **one dashboard for all subscriptions**.
Keep expectations honest — Baton reports what it can actually know, and labels the rest.

## Data sources (in order of trust)

1. **Structured output of runs Baton itself launched** (always available):
   - Claude: final envelope metadata (turns, usage fields when present).
   - Codex: `turn.completed` token usage from the `--json` stream — the richest source.
   - Gemini: `stats.models.*.tokens` (prompt/response/cached/total) from json output.
   Recorded per turn into `~/.baton/usage.json` as append-only events:
   `{ ts, agent, project, inputTokens?, outputTokens?, endedBy }`.
2. **Limit events** — every `limit` classification writes a cooldown record with its
   `resetHint` string.
3. **Optional local history (M7 stretch, read-only, behind `--deep`):**
   - Claude Code JSONL transcripts under `~/.claude/projects/` (the ccusage approach).
   - Codex session logs under `~/.codex/`.
   Parse defensively: unknown format → skip silently, never crash `status`. These
   formats are undocumented internals and may change any day; guard every field access.

   **Boundaries of this read (enforced in code, proven by tests):** only `*.jsonl` files
   are opened; any file whose name suggests a secret (`credential`, `auth`, `token`,
   `secret`, `cookie`, `session-key`, `.key`, `.pem`) is skipped *before* it is opened;
   only numeric token counts and timestamps are extracted, never transcript text; nothing
   is ever written into those directories; and the read happens only when the user types
   `--deep`, which then prints exactly which directory was read and how many files.
   `BATON_CLAUDE_HOME` / `BATON_CODEX_HOME` redirect the read (tests use them, so no test
   ever touches a real home directory).

**Never** attempt to query provider servers for quota. That would require credentials —
forbidden by the prime rule.

## `baton status` output (see UX-SPEC.md for styling)

```
BATON STATUS                                    project: my-app

AGENT    STATE        TODAY (baton runs)     LAST LIMIT        NOTE
claude   ● ready      3 runs · 41k in/9k out —
codex    ◌ cooling    5 runs · 88k in/21k out 14:02 (resets ~19:00)
gemini   ● ready      1 run  · 120k in/2k out —
                                             (tokens = runs launched via baton only)
```

- `--json` flag prints the same as machine-readable JSON (for the community to build on).
- `--deep` adds the optional local-history totals per provider with a `(local history)`
  label.
- If a provider was never run via Baton: `no data yet — run something with baton run`.

## Retention

`usage.json` is pruned to the last 90 days on write. One file, human-readable, and
`baton status --reset` clears it after a y/N confirm.
