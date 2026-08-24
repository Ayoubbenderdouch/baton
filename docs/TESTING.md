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
