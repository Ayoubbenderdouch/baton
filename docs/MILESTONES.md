# Baton — Milestones (build in this exact order)

One milestone = one or more commits + green CI on ubuntu/macos/windows + its checklist
ticked in this file (edit the boxes as you go). Never start Mn+1 with Mn red.

## Verification status legend

The build happened on a macOS machine with no GitHub remote yet (creating the repo is
the maintainer's call — see README-KIT). So:

- `[x]` = implemented **and** verified locally (lint + typecheck + vitest + build, and
  where relevant the pack smoke on macOS).
- `⏳ (pending: CI)` = the 3-OS matrix has never run; it will on the first push.
- `⏳ (pending: Windows)` = needs a real Windows machine or windows-latest CI.

Nothing here claims a green windows-latest run that did not happen. The OS-sensitive
logic (PATHEXT resolution, CRLF stream splitting, atomic-rename fallback, Unicode) is
covered by tests that run on macOS too, so the risk carried into CI is small but real.

## M0 — Scaffold
- [x] `npm init` → name `baton-ai`, bin `baton`, `"type": "module"`, Node ≥20 engines
- [x] TypeScript strict, ESM build (tsup or tsc), eslint + prettier, vitest wired
- [x] `src/index.ts` with commander skeleton: all commands registered, printing "not
      implemented yet" except `--version`
- [x] CI matrix per CROSS-PLATFORM.md incl. pack-smoke job — written; ⏳ (pending: CI) run
- [x] LICENSE (MIT), README stub with the non-affiliation disclaimer
- DoD: `npx baton --version` works from a packed tarball — verified on macOS via
  `npm run smoke`; ⏳ (pending: CI) for ubuntu/windows

## M1 — Detection & doctor
- [x] `resolveBin()` with PATHEXT handling + unit tests (fake shims fixture)
- [x] Adapter registry + `detect()` for claude/codex/gemini (version + auth probe;
      the probe is opt-in via `baton doctor --probe` because it costs one request)
- [x] `baton doctor` and `baton agents` per UX-SPEC
- DoD: fake-shim test proves detection (runs on every OS; Windows semantics covered by
  platform-parameterised `resolveBin` tests) ⏳ (pending: CI) for the windows-latest run;
  real-machine manual check documented in TESTING.md (L1–L3 ✅ macOS, ⏳ Windows)

## M2 — Claude adapter + run pipeline
- [x] Event model (`AgentEvent`) + renderer (TTY spinner path + plain `baton:` path)
- [x] ClaudeAdapter: spawn, parse json/stream-json fixtures, permission mapping
- [x] SessionStore v1: `.baton/session.json` turns + rolling summary
- [x] `baton run "task" --agent claude` end-to-end
- DoD: fixture-driven parser tests + an offline spawn→parse→event integration test
  against a fake CLI (covers CRLF, ENOENT, auth-vs-crash, cancel); live run verified on
  macOS (TESTING.md L4) and Ctrl+C leaves zero orphans (L5); ⏳ (pending: Windows)

## M3 — Codex & Gemini adapters
- [x] CodexAdapter (`codex exec --json`) with usage extraction from `turn.completed`
- [x] GeminiAdapter (stream-json), approval mapping (`plan`/`auto_edit`, yolo only under
      `--unsafe`), "never ask" preamble
- [x] Fixtures: ok/limit/auth/crash per provider (+ the two real safety-gate refusals);
      provenance table in `fixtures/README.md` — limit/auth are synthesized, and say so
- DoD: `baton run --agent codex|gemini` live-verified on macOS (TESTING.md L6, L7);
  ⏳ (pending: Windows)

## M4 — Handoff
- [x] HandoffWriter per FAILOVER.md template; deterministic; snapshot tests
- [x] Rolling-summary compression (pure string logic + tests)
- [x] `baton handoff` command; refresh after every done turn
- DoD: snapshot test with Arabic content passes locally, and `RELAY_PREAMBLE` is
  compared against docs/FAILOVER.md by a test so the two cannot drift;
  ⏳ (pending: CI) for the windows-latest run

## M5 — Limit detection & the relay ⭐
- [x] LimitDetector layers A/B/C + patterns.json extension mechanism
- [x] Cooldown ledger (`~/.baton/usage.json`, the schema USAGE-TRACKING.md specifies)
- [x] FailoverEngine relay loop (maxRelays, loop protection, chain filtering)
- [x] `BATON_TEST_FORCE_LIMIT=<agent>` env hook — test-only, documented in the README
- DoD: integration tests cover every relay invariant by name (preamble handed over,
  HANDOFF written before the next spawn, partial turn persisted, maxRelays, no relay to
  an already-limited agent, cooldown respected, undetected agents skipped, exhausted
  reporting, relay-on-error opt-in). Verified live on macOS with
  `BATON_TEST_FORCE_LIMIT=claude` → relayed to codex, which finished the task
  (TESTING.md L8); ⏳ (pending: CI) for the 3-OS run.

## M6 — Router & config
- [x] zod-validated config: global + project merge + flag overrides, `config get/set`
      (unknown keys warn with a did-you-mean; `roles`/`agents` merge key by key so
      setting one role does not drop the others)
- [x] Roles map, rules engine, availability filter, decision line in UI
- [x] `baton init` — interactive on a TTY via node:readline (no new dependency),
      silent defaults everywhere else
- DoD: 25 table-driven router tests including the Arabic-keywords example and the
  availability filter; router decisions verified live with `BATON_TEST_FAKE=1`

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
