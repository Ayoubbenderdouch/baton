# Changelog

All notable changes to Baton are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses semver.

## [Unreleased]

### Added

- M1 detection: `resolveBin()` (PATHEXT-aware, returns the real on-disk casing), an
  adapter registry with `detect()` for Claude Code, Codex and Gemini, plus `baton doctor`
  (with opt-in `--probe`) and `baton agents`.
- M0 scaffold: `baton-ai` package (ESM, Node >= 20), TypeScript strict build via tsup,
  eslint + prettier + vitest wiring, the full command surface as a skeleton, MIT license,
  README stub with the non-affiliation disclaimer, and a 3-OS CI matrix with a
  pack-smoke job.
