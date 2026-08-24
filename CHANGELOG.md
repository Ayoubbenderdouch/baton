# Changelog

All notable changes to Baton are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses semver.

## [0.1.0] — 2026-08-24

First release. Baton runs the official Claude Code, Codex and Gemini CLIs for you and
passes the baton — with the full context — when one hits its usage limit.

### Added

- **`baton run "task"`** — routes the task to the best-suited agent, spawns that
  provider's official CLI headless, and streams its work live (spinner and tool lines on
  a TTY, plain `baton:` lines in a pipe or CI).
- **The relay.** When a provider reports a usage limit, Baton records a cooldown, writes
  a `HANDOFF.md` briefing at the project root, announces the hand-off, and starts the
  next agent in the chain with a stable preamble telling it to read the briefing and
  continue. Loop protection: never back to an agent that already hit its limit for this
  task, never more than `maxRelays` hand-offs, and never a relay on a failure that is not
  a usage limit unless you pass `--relay-on-error`.
- **Usage-limit detection** that prefers structured signals: Claude Code's
  `rate_limit_event` carries an exact reset time, and per-provider text patterns run over
  failure output only. Anything unrecognised counts as a crash, so Baton stops instead of
  spending a second provider's quota. `~/.baton/patterns.json` extends the built-in
  patterns without waiting for a release.
- **`baton continue`** — picks the last task back up: the same agent through its own
  session resume when it is available, otherwise the next agent with the handoff.
- **`baton status`** — one table across all three subscriptions: runs and tokens Baton
  itself launched, plus any cooldown and its reset hint. `--json` for scripting,
  `--reset` to clear the ledger, `--deep` for an optional read-only pass over the
  providers' own local logs.
- **`baton doctor` / `baton agents`** — what is installed, what needs a login, and the
  provider's own fix command. The sign-in probe is opt-in (`--probe`) because verifying a
  login costs one request.
- **`baton handoff`**, **`baton config`** (layered defaults → global → project → flags,
  with the origin of every key) and **`baton init`**.
- **Windows, macOS and Linux as equals**: PATHEXT-aware binary resolution, `\r\n`-safe
  stream splitting, atomic config writes with the Windows rename fallback, whole-tree
  process kill, and Unicode (Arabic + emoji) carried end to end.
- **Test hooks that cost nothing**: `BATON_TEST_FORCE_LIMIT=<agent>` simulates a limit
  without spawning the provider at all, and `BATON_TEST_FAKE=1` replaces every adapter
  with a fake so a whole task can run with no CLI, no account and no network.

### Safety

- Baton never reads, stores, transmits or manages any provider credential, and never
  edits `~/.claude`, `~/.codex` or `~/.gemini`. It makes no network calls of its own: no
  telemetry, no update checks. There are no postinstall scripts.
- Provider bypass modes (`--dangerously-skip-permissions`, Codex's sandbox bypass,
  Gemini's `yolo`) are reachable only through Baton's explicit `--unsafe`, with a warning.
- Providers' own safety gates — Gemini's untrusted-folder refusal, Codex's git-repo
  requirement — are explained with the exact remedy rather than silently bypassed.

### Known limitations

- The text limit patterns are written from the providers' documented wording rather than
  captured from a real exhausted account; Claude's structured signal is captured from a
  real run. See `fixtures/README.md`.
- The three-OS CI matrix ships with this release but has not run yet, and the Windows
  manual checks in `docs/TESTING.md` are still open.
- Gemini is treated as stateless (its `--resume` takes an index, not a session id), so
  its continuity always goes through `HANDOFF.md`.
- One agent at a time: Baton is a relay, not a swarm.
