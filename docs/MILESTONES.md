# Baton — Milestones (build in this exact order)

One milestone = one or more commits + green CI on ubuntu/macos/windows + its checklist
ticked in this file (edit the boxes as you go). Never start Mn+1 with Mn red.

## Verification status legend

- `[x]` = implemented, verified locally, **and** green in CI.
- `⏳ (pending: Windows)` = needs a real Windows machine with logged-in provider CLIs;
  the automated Windows coverage (CI) is green, the human walk-through is not done.

**CI status: green on ubuntu-latest, macos-latest and windows-latest × Node 22 and 24,
plus the pack-smoke job on all three, since 2026-08-24.** The first run was red and found
three real bugs (execa 10 needs Node 22; POSIX file-mode tests cannot run on Windows; a
CRLF checkout broke the generated-docs comparison) — all fixed in `fix(ci): require Node
22, and make two tests survive a Windows runner`.

## M0 — Scaffold
- [x] `npm init` → name `baton-ai`, bin `baton`, `"type": "module"`, Node ≥20 engines
- [x] TypeScript strict, ESM build (tsup or tsc), eslint + prettier, vitest wired
- [x] `src/index.ts` with commander skeleton: all commands registered, printing "not
      implemented yet" except `--version`
- [x] CI matrix per CROSS-PLATFORM.md incl. pack-smoke job — green on all three OSes
- [x] LICENSE (MIT), README stub with the non-affiliation disclaimer
- DoD: `npx baton --version` works from a packed tarball — green in the pack-smoke job on
  ubuntu, macos and windows

## M1 — Detection & doctor
- [x] `resolveBin()` with PATHEXT handling + unit tests (fake shims fixture)
- [x] Adapter registry + `detect()` for claude/codex/gemini (version + auth probe;
      the probe is opt-in via `baton doctor --probe` because it costs one request)
- [x] `baton doctor` and `baton agents` per UX-SPEC
- DoD: fake-shim test proves detection on windows-latest in CI (green); real-machine
  manual check documented in TESTING.md (L1–L3 ✅ macOS, ⏳ Windows)

## M2 — Claude adapter + run pipeline
- [x] Event model (`AgentEvent`) + renderer (TTY spinner path + plain `baton:` path)
- [x] ClaudeAdapter: spawn, parse json/stream-json fixtures, permission mapping
- [x] SessionStore v1: `.baton/session.json` turns + rolling summary
- [x] `baton run "task" --agent claude` end-to-end
- DoD: fixture-driven parser tests + an offline spawn→parse→event integration test
  against a fake CLI (covers CRLF, ENOENT, auth-vs-crash, cancel); live run verified on
  macOS (TESTING.md L4) and Ctrl+C leaves zero orphans (L5); green on windows-latest in
  CI; ⏳ (pending: Windows) for the live run with a real account

## M3 — Codex & Gemini adapters
- [x] CodexAdapter (`codex exec --json`) with usage extraction from `turn.completed`
- [x] GeminiAdapter (stream-json), approval mapping (`plan`/`auto_edit`, yolo only under
      `--unsafe`), "never ask" preamble
- [x] Fixtures: ok/limit/auth/crash per provider (+ the two real safety-gate refusals);
      provenance table in `fixtures/README.md` — limit/auth are synthesized, and say so
- DoD: `baton run --agent codex|gemini` live-verified on macOS (TESTING.md L6, L7),
  fixture-verified on windows-latest in CI; ⏳ (pending: Windows) for a live run there

## M4 — Handoff
- [x] HandoffWriter per FAILOVER.md template; deterministic; snapshot tests
- [x] Rolling-summary compression (pure string logic + tests)
- [x] `baton handoff` command; refresh after every done turn
- DoD: the Arabic-content snapshot passes on windows-latest in CI, and `RELAY_PREAMBLE`
  is compared against docs/FAILOVER.md by a test so the two cannot drift

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
  (TESTING.md L8), and green on all three OSes in CI.

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
- [x] usage.json event log + pruning; `baton status` table + `--json` (+ `--reset`)
- [x] Cooldown display with reset hints
- [x] `--deep` optional local-history readers (defensive parsing, every field guarded,
      redirectable with `BATON_CLAUDE_HOME` / `BATON_CODEX_HOME` so tests never read a
      real home directory)
- DoD: covered by tests for zero data, partial data (including a run that reported no
  token counts) and all agents cooling; verified live against the ledger this build
  produced

## M8 — Polish & release
- [x] README: hero gif placeholder, quickstart, safety/philosophy section, config
      reference generated from the zod schema (`docs/CONFIG.md`, kept in sync by a test),
      Arabic quickstart (`docs/README.ar.md`)
- [x] `--help` polish (examples + disclaimer), error remedies audit, `last-error.log`
- [x] `baton continue` implemented — it is in the documented command surface, so it does
      not ship as a stub
- [x] Optional: Ink interactive shell — **built after v0.1.0 was tagged**, on request.
      `baton` with no task opens it: a welcome screen that lists every agent with the
      provider's own fix command, then a menu (run a task · choose folder · status · quit)
      and a live streaming pane. It **never runs a login** — it prints the command and
      re-checks on `r`, keeping the credential promise literally true. Ink and React load
      lazily, so `baton run "task"` still pays nothing for them.
- [x] `npm publish --dry-run` clean (5 files: dist, README, LICENSE, CHANGELOG,
      package.json); CHANGELOG.md written in user language; v0.1.0 tag prepared locally
      (publishing stays manual, the maintainer's call)
- DoD: verified locally end to end from the packed tarball — install → `baton doctor` →
  `baton run` → forced limit → relay announcement → `HANDOFF.md` → `baton status`, and
  the same flow green in the windows-latest pack-smoke job.
  ⏳ (pending: Windows) for a human walk-through with real accounts.

## Explicitly out of scope for v0.1
Parallel agents, LLM routing, plugins/marketplace, provider auth handling of any kind,
telemetry, auto-update.
