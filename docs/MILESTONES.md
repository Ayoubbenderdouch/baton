# Baton — Milestones (build in this exact order)

One milestone = one or more commits + green CI on ubuntu/macos/windows + its checklist
ticked in this file (edit the boxes as you go). Never start Mn+1 with Mn red.

## M0 — Scaffold
- [ ] `npm init` → name `baton-ai`, bin `baton`, `"type": "module"`, Node ≥20 engines
- [ ] TypeScript strict, ESM build (tsup or tsc), eslint + prettier, vitest wired
- [ ] `src/index.ts` with commander skeleton: all commands registered, printing "not
      implemented yet" except `--version`
- [ ] CI matrix per CROSS-PLATFORM.md incl. pack-smoke job
- [ ] LICENSE (MIT), README stub with the non-affiliation disclaimer
- DoD: `npx baton --version` works from a packed tarball on all 3 OSes in CI

## M1 — Detection & doctor
- [ ] `resolveBin()` with PATHEXT handling + unit tests (fake shims fixture)
- [ ] Adapter registry + `detect()` for claude/codex/gemini (version + auth probe)
- [ ] `baton doctor` and `baton agents` per UX-SPEC
- DoD: fake-shim CI test proves detection on windows-latest; real-machine manual check
  documented in TESTING.md checklist

## M2 — Claude adapter + run pipeline
- [ ] Event model (`AgentEvent`) + renderer (TTY + non-TTY paths)
- [ ] ClaudeAdapter: spawn, parse json/stream-json fixtures, permission mapping
- [ ] SessionStore v1: `.baton/session.json` turns + rolling summary
- [ ] `baton run "task" --agent claude` end-to-end
- DoD: fixture-driven unit tests for parser; manual live run on macOS + Windows ticked

## M3 — Codex & Gemini adapters
- [ ] CodexAdapter (`codex exec --json`) with usage extraction from `turn.completed`
- [ ] GeminiAdapter (json + stream-json), yolo mapping, "never ask" preamble
- [ ] Fixtures: ok/limit/auth/crash per provider
- DoD: `baton run --agent codex|gemini` live-verified on both OSes

## M4 — Handoff
- [ ] HandoffWriter per FAILOVER.md template; deterministic; snapshot tests
- [ ] Rolling-summary compression (pure string logic + tests)
- [ ] `baton handoff` command; refresh after every done turn
- DoD: snapshot test with Arabic content in the task passes on windows-latest

## M5 — Limit detection & the relay ⭐
- [ ] LimitDetector layers A/B/C + patterns.json extension mechanism
- [ ] Cooldown ledger
- [ ] FailoverEngine relay loop (maxRelays, loop protection, chain filtering)
- [ ] `BATON_TEST_FORCE_LIMIT=<agent>` env hook so the relay is testable without
      burning real quotas (adapter emits fixture limit when set) — test-only, documented
- DoD: integration test: run → forced limit on claude → relay to codex fixture →
  HANDOFF injected → done. Green on all OSes.

## M6 — Router & config
- [ ] zod-validated config: global + project merge + flag overrides, `config get/set`
- [ ] Roles map, rules engine, availability filter, decision line in UI
- [ ] `baton init`
- DoD: table-driven router tests (≥15 cases incl. Arabic keywords example)

## M7 — Status
- [ ] usage.json event log + pruning; `baton status` table + `--json`
- [ ] Cooldown display with reset hints
- [ ] `--deep` optional local-history readers (defensive parsing, feature-flagged)
- DoD: status renders correctly with zero data, partial data, all agents cooling

## M8 — Polish & release
- [ ] README: hero gif placeholder, quickstart, safety/philosophy section ("why Baton
      never touches your tokens"), config reference generated from zod schema, Arabic
      quickstart section (`docs/README.ar.md`)
- [ ] `--help` polish, error remedies audit, `last-error.log`
- [ ] Optional: Ink interactive shell (skip if time-boxed out — do NOT delay release)
- [ ] `npm publish --dry-run` clean; CHANGELOG.md; v0.1.0 tag
- DoD: a stranger on Windows can go README → installed → first relay in <10 minutes

## Explicitly out of scope for v0.1
Parallel agents, LLM routing, plugins/marketplace, provider auth handling of any kind,
telemetry, auto-update.
