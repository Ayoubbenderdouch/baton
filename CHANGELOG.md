# Changelog

All notable changes to Baton are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses semver.

## [Unreleased]

### Added

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
