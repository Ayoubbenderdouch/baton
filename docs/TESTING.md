# Baton — Testing strategy

Principle: **CI must never depend on real provider CLIs, accounts, or networks.**
Everything on the critical path is provable with fixtures and fakes; live checks are a
short manual checklist per milestone.

## Layers

1. **Unit (vitest):** parsers, LimitDetector, HandoffWriter (snapshots), router tables,
   resolveBin (with a temp PATH + fake `.cmd`/`sh` shims), config merge, atomic writes.
2. **Integration (vitest, still offline):** orchestrator + FailoverEngine wired to a
   `FakeAdapter` that replays fixture event scripts (ok / limit-mid-run / auth / crash /
   stall). The M5 relay test lives here and is the most important test in the repo.
3. **Pack smoke (CI job):** `npm pack` → install tarball in temp dir → `baton --version`,
   `baton doctor` against fake shims, `baton run` against FakeAdapter via
   `BATON_TEST_FAKE=1`. Runs on the full OS matrix.
4. **Live manual checklist (per milestone, humans only):** documented commands to run
   once on a real macOS and a real Windows machine with actual logged-in CLIs; results
   ticked in MILESTONES.md. Live runs are cheap-prompt only ("reply with the word ok")
   to protect quotas.

## Fixtures

`fixtures/<agent>/` captured from real runs (sanitized: strip usernames/paths/ids):
`ok-final.json`, `ok-stream.jsonl`, `limit.txt`, `limit-stream.jsonl`, `auth.txt`,
`crash.txt`, plus `unicode-task.txt` (Arabic + emoji). Every LimitDetector default
pattern references at least one fixture line in a test.

## Colour in tests

CI runners set `FORCE_COLOR`, a piped local shell does not — so a test that compares
rendered output must strip ANSI before asserting, or it passes locally and fails in CI.
`npm run test:ci` reproduces the CI colour setting locally.

## Conventions

- Test files beside sources: `foo.ts` / `foo.test.ts`.
- No test writes outside `os.tmpdir()`; `BATON_HOME` always pointed at a temp dir.
- Determinism: fake clock for cooldowns; seedless; snapshots stable across OS
  (normalize path separators + line endings before snapshotting).
- Coverage gate: 85% lines on `src/core/**` and `src/adapters/**` parsers (rendering
  code exempt).

## Bug rule

Every real-world parsing bug found later gets its raw output added as a fixture first,
then fixed. The fixture corpus is the project's crown jewels.

---

## Live manual checklist (humans + real accounts)

CI never runs these. Run them once per milestone on a real machine with the provider
CLIs installed and logged in, then record the result here. Keep every live prompt
trivial ("reply with the word ok") — this checklist must never cost real quota.

Legend: ✅ verified · ⏳ pending (no machine of that OS available yet).

| # | Milestone | Command | macOS | Windows |
|---|---|---|---|---|
| L1 | M1 | `baton doctor` — three CLIs detected with versions | ✅ 2026-08-24 (claude 2.1.241, codex 0.147.0, gemini 0.56.0) | ⏳ |
| L2 | M1 | `baton doctor --probe` — auth verified via one tiny prompt each | ✅ 2026-08-24 (3/3 signed in) | ⏳ |
| L3 | M1 | `baton agents` — resolved binary paths look right | ✅ 2026-08-24 | ⏳ |
| L4 | M2 | `baton run --agent claude "reply with the word ok"` streams and ends `done` | ⏳ | ⏳ |
| L5 | M2 | `Ctrl+C` mid-run leaves no orphan `node`/provider processes | ⏳ | ⏳ |
| L6 | M3 | `baton run --agent codex "reply with the word ok"` | ⏳ | ⏳ |
| L7 | M3 | `baton run --agent gemini "reply with the word ok"` | ⏳ | ⏳ |
| L8 | M5 | `BATON_TEST_FORCE_LIMIT=claude baton run "…"` relays to codex for real | ✅ 2026-08-24 (handoff written, codex finished the task) | ⏳ |
| L9 | M8 | Fresh install from the packed tarball, `baton --version`, `baton doctor` | ✅ 2026-08-24 (`npm run smoke`) | ⏳ |
| L10 | M8 | Whole flow from the tarball: run → forced limit → relay → HANDOFF.md → status | ✅ 2026-08-24 | ⏳ |
| L11 | M8 | `baton continue` resumes the previous agent's own session | ✅ 2026-08-24 (claude resume) | ⏳ |
| L12 | QA | `--auto` really edits files, per agent: claude · codex · gemini | ✅ 2026-08-24 (all three wrote the file; "1 file changed" from git) | ⏳ |
| L13 | QA | `safe` mode does not write files | ✅ 2026-08-24 | ⏳ |
| L14 | QA | A provider gate refuses, its remedy command is run, the retry succeeds | ✅ 2026-08-24 (gemini trust → `baton config set agents.gemini.extraArgs -- --skip-trust`) | ⏳ |
| L15 | QA | Error paths return the right exit codes (2 usage · 3 exhausted · 130 cancel) | ✅ 2026-08-24 | ⏳ |
| L16 | QA | Piping into `head` exits quietly instead of dumping an EPIPE stack | ✅ 2026-08-24 | ⏳ |

Windows rows stay ⏳ until someone runs them on a real Windows machine **with logged-in
provider CLIs** — that is the only thing CI cannot do. Everything else is covered:
since 2026-08-24 the matrix is green on ubuntu/macos/windows × Node 22/24, including the
pack-smoke job that installs the tarball and runs a whole task with fake adapters.
