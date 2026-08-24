# Changelog

All notable changes to Baton are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses semver.

## [Unreleased]

### Added

- M7 status: `baton status` shows every agent's state, today's runs and tokens (from what
  Baton itself launched), and any cooldown with its reset hint — plus `--json` for
  scripting, `--reset` to clear the history, and an optional `--deep` read-only pass over
  the providers' own local logs.
- M6 router and config: deterministic routing (explicit flag → role → keyword/size rules
  → chain head) with the decision printed in one line, and a zod-validated config layered
  default → global → project → flags, editable with `baton config set roles.architect
  codex`. `baton init` writes a project config.
- M5 the relay: usage-limit detection (Claude's structured `rate_limit_event` first,
  then per-provider pattern tables extensible through `~/.baton/patterns.json`), a
  cooldown ledger in `~/.baton/usage.json`, and the failover engine that writes
  HANDOFF.md and hands the same task to the next agent in the chain. `--chain` overrides
  the order, `--relay-on-error` opts into relaying on non-limit failures, and
  `BATON_TEST_FORCE_LIMIT=<agent>` exercises the whole path without spending quota.
- M4 handoff: `HANDOFF.md` generated from the session store and live git state, written
  to the project root and mirrored into `.baton/`, refreshed after every turn. Rolling
  summary compression is pure string logic (no LLM — the account that would run it may be
  the one at its limit). `baton handoff` writes it on demand.
- M3 adapters: Codex (`codex exec --json`, thread resume, sandbox mapping) and Gemini
  (`-o stream-json`, `plan`/`auto_edit` approval mapping, non-interactive preamble), both
  fixture-driven. Provider safety gates (Gemini's untrusted folder, Codex's git-repo
  requirement) are explained with the exact remedy instead of being silently bypassed.
- M2 run pipeline: the `AgentEvent` model, a Claude Code adapter (stream-json parsing
  proven by real 2.1.241 captures in `fixtures/claude/`), the live run renderer, the
  `.baton/session.json` store, and `baton run "task" --agent claude` end to end.
  Claude's `rate_limit_event` is parsed as a structured limit signal with an exact reset
  time. Cancellation kills the whole process tree on both platforms.
- M1 detection: `resolveBin()` (PATHEXT-aware, returns the real on-disk casing), an
  adapter registry with `detect()` for Claude Code, Codex and Gemini, plus `baton doctor`
  (with opt-in `--probe`) and `baton agents`.
- M0 scaffold: `baton-ai` package (ESM, Node >= 20), TypeScript strict build via tsup,
  eslint + prettier + vitest wiring, the full command surface as a skeleton, MIT license,
  README stub with the non-affiliation disclaimer, and a 3-OS CI matrix with a
  pack-smoke job.
