# Baton v0.1.0 — release readiness

A verification pass, not a summary: every line below was produced by running something.
Date: 2026-08-24 · macOS (darwin 25.3.0) · Node v26.7.0 · commit `05e2a9e`.

Nothing here is marked done on the strength of an earlier claim. Where a check needed a
fix first, the fix is linked to its commit and the check was re-run.

---

## 1. Milestones

Proof column = the command that was run. All of them pass on this machine, and the same
suites pass in CI on ubuntu, macOS **and** Windows × Node 22/24.

| Milestone | Status | Proof |
|---|---|---|
| M0 Scaffold | ✅ | `npm run lint` · `npm run typecheck` · `npm run build` · package invariants (name, bin, type module, engines >=22, exports, files allowlist, keywords, no postinstall) checked field by field |
| M1 Detection & doctor | ✅ | `npx vitest run src/core/resolve-bin.test.ts` (11 tests, PATHEXT semantics) · `src/adapters/detect.test.ts` (fake shims) · `baton doctor` and `baton agents` run with exit 0 |
| M2 Claude adapter + run pipeline | ✅ | `src/adapters/claude/parse.test.ts` against real 2.1.241 captures · `src/adapters/run-provider.test.ts` (spawn→parse→events, CRLF, ENOENT, cancel) · live `baton run --agent claude` |
| M3 Codex & Gemini adapters | ✅ | `src/adapters/{codex,gemini}/parse.test.ts` against real captures · fixtures ok/limit/auth/crash present for all three · live runs incl. `--auto` writing real files |
| M4 Handoff | ✅ | `src/core/handoff.test.ts` (13) incl. `RELAY_PREAMBLE` compared against docs/FAILOVER.md · Arabic snapshot · template conformance checked section by section (8/8) |
| M5 Limit detection & relay | ✅ | `src/core/failover.test.ts` — 13 invariants, each named · `src/core/limit-detector.test.ts` (12) incl. "every pattern has a fixture" and "zero false positives on healthy runs" · live forced-limit relay |
| M6 Router & config | ✅ | `src/core/router.test.ts` — 18 table-driven cases (≥15 required) + Arabic keywords + availability filter · `src/core/config.test.ts` merge/dot-path/did-you-mean |
| M7 Status | ✅ | `src/core/status.test.ts` — zero data, partial data, all agents cooling, `--deep` bounds · live `baton status`, `--json`, `--reset` |
| M8 Polish & release | ✅ | `npm run smoke` · `npm publish --dry-run` · docs/CONFIG.md generated from the zod schema and guarded by a test · docs/README.ar.md · `last-error.log` tested |
| M8 Ink interactive shell | ⏭️ | Deliberately skipped — docs/MILESTONES.md marks it optional and says not to delay the release for it |

**Suites:** `npm test` → **284 tests, 30 files, all passing**. `npm run test:ci` (CI colour
settings) → same. Coverage gate from docs/TESTING.md, measured per glob:
`src/core/**` **94.44 %** lines · `src/adapters/**` **92.22 %** · adapter parsers **93.66 %**
(gate: 85 %).

Two things this pass fixed rather than waved through:

- The coverage gate was verified to actually *gate* (raising a threshold to 99.9 % makes
  the run fail). It does. But `src/adapters/**` sat at 85.56 %, half a point of margin,
  with `fake.ts` at 5.55 % — shipped code the README tells people to use. Tests added
  (`test: cover the fake adapter and the adapter wiring`), now 92.22 %.
- `baton doctor --probe` reported "unclear" when a provider's own gate blocked the probe.
  Fixed to name the gate and its remedy (`fix(doctor): name the real reason…`).
- The tests written for that fix needed a shell shim that answers `--version` but fails
  the probe, and the Windows `.cmd` form of it was wrong — green here, red on both
  windows-latest jobs. The logic is pure, so it is now a pure function tested directly
  against the captured refusals (`fix(test): test the probe classification purely…`).
  Worth stating plainly: CI caught this, a local run could not have.

## 1b. The UI overhaul (after v0.1.0 was tagged)

The interactive shell was rebuilt to the design language in docs/UX-SPEC.md — bordered
input as the anchor, agent chips beneath it, a status line with a rotating verb and
elapsed time, tool lines with nested results, frozen `<Static>` history, and an ASCII
fallback profile. Presentation only: core, adapters and the orchestrator were not touched
and their tests never moved.

| Guarantee | How it is held |
|---|---|
| Layout cannot drift | Six colour-stripped snapshots: idle, ASCII idle, running block, relay block, error block, non-TTY transcript |
| One visual system | `src/ui/format.ts` builds every line; the shell boxes them, `baton run` writes them — the same strings |
| No orange, ever | A test computes the hue of every theme colour and fails inside the orange family; a second fails on any hex literal outside `theme.ts` |
| Alignment | Real cell widths (CJK 2, ZWJ 0) via `string-width`, never `.length` |
| Legacy terminals | Glyph profile auto-selected (no `WT_SESSION`, `TERM=dumb`), or `--ascii` / `BATON_ASCII=1`; a test asserts the transcript is then **pure ASCII**, prose included |
| Keybindings | One pure function with its own tests (enter · esc · double ctrl+c · tab · ctrl+s/d/r) |
| Performance | History frozen in `<Static>`; one shared 10fps clock for every animated element — `ora` was dropped, one dependency fewer |

**Not verified:** how it looks on a real TTY. Everything is snapshot-tested, but no human
has watched it render — docs/TESTING.md L18–L20 cover that, the ASCII profile on a legacy
Windows console, and the clean terminal restore on exit.

## 2. Security audit — prime rule

Method: every production file (57, tests excluded) grepped for each class of violation.

| Check | Result |
|---|---|
| Network calls originating from Baton | **zero** |
| Reading, storing, transmitting or managing tokens / API keys / credentials | **zero** |
| Auth environment variables set for child processes | **zero** — the parent environment is passed through untouched |
| Writes into `~/.claude`, `~/.codex`, `~/.gemini` | **zero** |
| `postinstall` or any install-time script | **zero** |
| Telemetry, update checks, analytics | **zero** |

**One disclosed access, reported rather than hidden.** `src/core/deep-history.ts` *reads*
`~/.claude/projects` and `~/.codex/sessions` when — and only when — the user types
`baton status --deep`. This is not a prime-rule violation as this repo defines it: CLAUDE.md
and ARCHITECTURE.md forbid *edits* to those directories, and docs/USAGE-TRACKING.md §3
explicitly specifies this read-only pass as part of M7. It was not deleted, because
deleting a feature two normative docs require is not an audit's call. It was fenced
instead (`fix(security): fence the --deep local-history read and say it out loud`):

- a filename denylist (`credential`, `auth`, `token`, `secret`, `cookie`, `session-key`,
  `.key`, `.pem`) applies **before** any file is opened — a provider moving a secret into
  those trees cannot make Baton read it. Proven by a test that plants a
  `credentials.jsonl` containing a usage block and asserts it is skipped.
- only `*.jsonl` files, only numeric token counts and timestamps. A test asserts the
  returned object contains numbers and the disclosed path — never transcript content.
- `baton status --deep` now prints which directory it read and how many files it opened.
- `BATON_CLAUDE_HOME` / `BATON_CODEX_HOME` redirect the read; no test ever touches a real
  home directory.

If you prefer the stricter rule — zero reads of provider directories at all — the removal
is `src/core/deep-history.ts` plus the `--deep` branch in `src/cli/commands/status.ts`,
and docs/USAGE-TRACKING.md §3 and the M7 checkbox would need to change with it. Say the
word and it goes.

## 3. Provider matrix on this machine

| Agent | Installed | Version | Auth verdict | Notes |
|---|---|---|---|---|
| Claude Code | ✅ `~/.local/bin/claude` | 2.1.241 | **signed in** (`baton doctor --probe`) | structured `rate_limit_event` with exact reset time |
| Codex CLI | ✅ `~/.local/bin/codex` | codex-cli 0.147.0 | **signed in** | refuses to run outside a git repo — Baton explains the gate |
| Gemini CLI | ✅ `~/.local/bin/gemini` | 0.56.0 | **signed in** | serves this consumer Google account; refuses untrusted folders |
| Antigravity | ❌ not installed | — | — | see below |

Every flag Baton passes was re-checked against the installed binaries' own `--help`: all
present. The two flags Baton deliberately avoids are still absent (`--max-turns`,
`codex exec --full-auto`). Recorded in docs/CLI-VERIFICATION.md.

**No AntigravityAdapter was written, on purpose.** `antigravity` is not on this machine
(no binary, nothing in the global npm list), and the premise that would call for it does
not hold: Gemini 0.56.0 answers this consumer account — `doctor --probe` says *signed in*,
and live `baton run --agent gemini --auto` turns complete and write files. The
adapter-development skill forbids a parser without a fixture captured from a real binary,
and there is nothing here to capture. If Google moves consumer accounts to Antigravity,
the work is one folder plus a registry line — which is what the adapter contract exists
for. Also present but out of scope: `kimi-cli`, `grok`, `cursor-agent`, `vibe`.

## 4. The relay, proven

13 named invariants in `src/core/failover.test.ts`, all green: preamble handed over ·
HANDOFF.md written **before** the next spawn · partial turn persisted with
`endedBy: "limit"` even when the relay then fails · `maxRelays` honoured · never back to
an agent already limited for this task · cooldown respected · undetected agents skipped ·
every blocking reason reported when nothing is left · `--relay-on-error` opt-in ·
exact reset time recorded in the ledger.

Live, end to end (`BATON_TEST_FAKE=1 BATON_TEST_FORCE_LIMIT=claude baton run …`):
forced limit → `HANDOFF.md` → `🏃 passing the baton → [codex]` → codex finishes, exit 0.
The generated `HANDOFF.md` was compared against the template in docs/FAILOVER.md §4:
**8 of 8 sections match**. An Arabic + emoji task survives the whole write path with no
CRLF. Cooldown persists across separate runs; with all three forced and `maxRelays: 1`
Baton stops after one hand-off with exit code 3 and `limitedAgents: ["claude","codex"]`.

## 5. Package hygiene

```
package/CHANGELOG.md   package/LICENSE   package/README.md
package/dist/index.js  package/package.json
```

Five files, 37.1 kB. No fixtures, no docs, no sources, no tests, no sourcemaps. The
tarball was installed into a clean temp project: the `baton` bin shim exists,
`baton --version` prints `0.1.0`, and `baton doctor` returns exit 0 against fake shims on
a PATH containing nothing but those shims and node. A complete task — forced limit,
relay, `HANDOFF.md` — runs from the installed package with no provider CLI present.
`npm publish --dry-run` is clean. **Nothing was published.** The name `baton-ai` is still
unregistered (404).

## 6. Known limitations of v0.1.0

- **The text limit patterns have never matched a real exhausted account.** Claude's
  structured signal is captured from a real run; the per-provider wordings are written
  from documented phrasing, and each is backed by a synthesized fixture that says so in
  `fixtures/README.md`. If a real limit is worded differently, Baton stops with an error
  instead of relaying. Mitigation shipped: `--verbose` prints every raw provider line, and
  `~/.baton/patterns.json` extends the built-in patterns without waiting for a release.
- **Windows is CI-green but has never been driven by a human.** The matrix covers it,
  including installing the tarball and running a task there. What is missing is one live
  session with logged-in provider CLIs.
- **Gemini is stateless by design.** Its `--resume` takes an index, not a session id, so
  Gemini's continuity always goes through `HANDOFF.md`.
- **One agent at a time.** Baton is a relay, not a swarm.
- **Zero real users.** Everything above is verification, not field evidence.

## 7. Remaining human steps

Already done, listed so nobody repeats them: the GitHub repo exists
(<https://github.com/Ayoubbenderdouch/baton>, public), `main` and the `v0.1.0` tag are
pushed, and the 3-OS CI matrix is **green** — latest run: https://github.com/Ayoubbenderdouch/baton/actions/runs/32824982827

**1 — Live smoke, macOS** (all verified once already; repeat after any change):

```bash
cd ~/Downloads/baton && npm run build && npm link
mkdir -p ~/Desktop/baton-live && cd ~/Desktop/baton-live && git init
baton doctor --probe                       # expect: 3/3 signed in
baton run --agent claude "reply with the word ok"
baton run --agent codex  "reply with the word ok"
baton run --agent gemini "reply with the word ok"
baton run --auto --agent claude "create hello.txt containing the word hello"
BATON_TEST_FORCE_LIMIT=claude baton run "reply with the word ok"   # the relay, for real
baton continue && baton status
```

**2 — Live smoke, Windows** (the only gap CI cannot close — needs logged-in CLIs):

```powershell
npm i -g baton-ai            # or: npm pack + npm i -g .\baton-ai-0.1.0.tgz
baton doctor --probe
baton run --agent claude "reply with the word ok"
$env:BATON_TEST_FORCE_LIMIT="claude"; baton run "reply with the word ok"
# Ctrl+C mid-run, then confirm no orphans:
Get-Process node,claude,codex,gemini -ErrorAction SilentlyContinue
```

Then tick the Windows column of `docs/TESTING.md` (L1–L16).

**3 — Publish** (maintainer only; nothing here publishes):

```bash
cd ~/Downloads/baton
git status --porcelain            # must be empty
npm test && npm run smoke && npm publish --dry-run
npm login && npm publish          # name baton-ai is free as of today
```

**4 — Tag** — `v0.1.0` already exists and is pushed. If you amend anything before
publishing, move it:

```bash
git tag -f -a v0.1.0 -m "baton-ai v0.1.0" && git push -f origin v0.1.0
```

**5 — Cosmetics before launch:** record the hero GIF of the relay
(`BATON_TEST_FAKE=1 BATON_TEST_FORCE_LIMIT=claude baton run "…"`) and decide what to do
with `README-KIT.md` and `00-MASTER-PROMPT.md`, which currently sit at the repo root and
are the first thing a visitor sees next to the README.
