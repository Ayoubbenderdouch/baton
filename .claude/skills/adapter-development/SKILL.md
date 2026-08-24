---
name: adapter-development
description: Rules and checklist for building or modifying any provider adapter (ClaudeAdapter, CodexAdapter, GeminiAdapter, or a new one like Kimi). Use this skill whenever touching anything under src/adapters/, adding fixtures, changing the AgentEvent mapping, changing spawn arguments or CLI flags, or adding support for a new AI provider — even for a "small" flag tweak.
---

# Adapter development

## Before writing code
1. Read docs/ADAPTERS.md for this provider, then run the REAL installed CLI's help
   (`claude --help`, `codex exec --help`, `gemini --help`) and diff against the doc.
   If reality differs, update docs/ADAPTERS.md in the same commit.
2. Capture/refresh fixtures from a real cheap run before parsing work. No parser change
   without a fixture proving the format.

## The contract (never violate)
- Implement `AgentAdapter` exactly (ARCHITECTURE.md). All provider-specific knowledge
  stays inside the adapter folder — nothing provider-specific may leak into core/.
- Spawn: execa + resolved binary + args ARRAY. Never `shell: true`. Never construct a
  command string. (cross-platform-safety skill has the full rules — read it too.)
- NEVER add flags, env vars, or file reads related to authentication or provider
  config. If a feature seems to need credentials, stop — it's out of scope by design.
- Unsafe permission modes (`--dangerously-*`, `--yolo`-class) only reachable through
  Baton's explicit `--unsafe`, never as a default or convenience.

## Event mapping checklist
- [ ] `start` emitted with sessionRef when the provider exposes one
- [ ] assistant text → `text` (chunked is fine; never buffer the whole run)
- [ ] tool activity → `tool` with a short human-readable detail
- [ ] token/usage info → `usage` (leave fields undefined when unknown — never guess)
- [ ] limit/auth/crash routed through LimitDetector, not classified ad hoc
- [ ] `done` always carries resultText (empty string only for hard crashes)
- [ ] stall heartbeat + runTimeout respected

## Definition of done for any adapter PR
Fixtures: ok-final, ok-stream, limit, auth, crash present · unit tests green on the OS
matrix · `baton doctor` verdict correct when the CLI is absent (ENOENT path tested with
a bogus PATH) · docs/ADAPTERS.md matches shipped behavior · manual live smoke on macOS
AND Windows ticked in MILESTONES.md.
