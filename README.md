<div align="center">

# 🏃 Baton

**Pass the baton, keep the context.**

One task. One context. Every subscription you already pay for.

[![CI](https://github.com/Ayoubbenderdouch/baton/actions/workflows/ci.yml/badge.svg)](https://github.com/Ayoubbenderdouch/baton/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/baton-ai.svg)](https://www.npmjs.com/package/baton-ai)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<!-- hero gif: baton run hitting a limit and relaying to the next agent -->
<!-- ![Baton relaying a task from claude to codex](docs/media/relay.gif) -->

[العربية](docs/README.ar.md) · [Configuration](docs/CONFIG.md) · [Architecture](docs/ARCHITECTURE.md)

</div>

---

You pay for Claude Max, ChatGPT and a Google account. Each one has its own CLI, its own
usage window, and its own way of stopping you at 11pm with *"you've reached your limit"*.

Baton runs those official CLIs for you, picks the one best suited to the task, and — when
it runs out — writes a briefing and hands the same task to the next one:

```
◇ baton run "fix the flaky auth test"
│ router → claude (keyword "fix the flaky")
│
▐ [claude] ─ working ⠋
│  reading src/auth/session.test.ts
│  The flakiness comes from a fixture shared between two tests…
│
⚡ [claude] hit its usage limit (resets 19:00)
🏃 passing the baton → [codex]  (handoff written: HANDOFF.md)
│
▐ [codex] ─ working ⠋
│  editing src/auth/fixtures.ts
◆ [codex] done in 2m 41s · 2 files changed
```

No restart. No re-explaining. No copy-pasting your task into a second tool.

## Install

```bash
npm i -g baton-ai      # needs Node 22 or newer
baton doctor
```

`baton doctor` tells you which agent CLIs are installed and which need a login. Baton
never installs or authenticates anything for you — it prints the provider's own command:

```
BATON DOCTOR

AGENT     INSTALLED  AUTH        VERDICT
[claude]  ● 2.1.241  not probed  ready
[codex]   ● 0.147.0  not probed  ready
[gemini]  ○ not installed  —     install it

✗ gemini: not installed -> run: npm i -g @google/gemini-cli

2/3 ready — baton can relay between claude and codex.
```

Then:

```bash
baton run "add tests for the payment webhook"   # routed, streamed, relayed if needed
baton continue                                  # pick it up tomorrow morning
baton status                                    # usage and cooldowns across all three
```

## Baton never touches your credentials

This is the whole design, not a footnote:

- **Zero credential contact.** Baton never reads, stores, transmits or manages a token,
  an API key or an auth file. It does not set auth environment variables and it does not
  write to `~/.claude`, `~/.codex` or `~/.gemini`.
- **Zero network calls.** Baton itself makes none — no telemetry, no update check, no
  analytics. The only processes talking to a provider are that provider's own CLI.
- **No postinstall scripts.** Nothing runs when you install it.
- **It is a remote control, not a proxy.** Your account stays entirely inside the tool
  each provider gave you, on their terms, with their own login.

The one thing Baton reads from your machine besides your project is its own state in
`~/.baton/` — and, only if you ask for it with `baton status --deep`, the token counts in
the providers' local logs, read-only. That read is deliberately narrow: `*.jsonl` files
only, anything whose name looks like a secret skipped before it is opened, numbers and
timestamps extracted and nothing else, nothing ever written — and `--deep` prints which
directory it read and how many files, so it is never quiet about it.

It also never quietly relaxes another tool's safety gate. When Gemini refuses an
untrusted folder or Codex refuses to run outside a git repo, Baton shows you the gate and
the exact way to open it — the decision stays yours.

## How the relay works

1. Your task goes to an agent (see [routing](#routing)).
2. Every turn is written to `.baton/session.json`, and `HANDOFF.md` is refreshed at the
   project root — a short briefing, not a transcript.
3. When a provider reports a usage limit, Baton records a cooldown, refreshes
   `HANDOFF.md`, and starts the next agent in the chain with this preamble:

   > You are taking over an in-progress coding task from another AI agent that hit its
   > usage limit. Read the file HANDOFF.md in the project root first, then continue the
   > task from where it stopped. …

4. Loop protection is strict: never back to an agent that already hit its limit for this
   task, never more than `maxRelays` hand-offs, never a relay on an error that is not a
   usage limit (unless you pass `--relay-on-error`).

Detection is structured-first: Claude's stream carries a machine-readable
`rate_limit_event` with an exact reset time. Where that does not exist, per-provider
patterns run over the failure output only, and anything unrecognised is treated as a
crash — Baton stops instead of spending a second provider's quota on a broken workspace.

## Routing

| Task looks like | Goes to | Why |
|---|---|---|
| debugging, architecture, race conditions | `claude` | hardest reasoning on the scarcest hours |
| implementing, tests, renames, migrations | `codex` | volume work |
| summarising, reviewing, very long inputs | `gemini` | long context and cheap questions |
| anything else | first available in the chain | |

Override any of it: `--agent codex`, `--role architect`, `--chain gemini,codex`, or edit
`roles` and `rules` in your config. Rules are plain lowercase substring matching, so
keywords in any language work — including Arabic:

```bash
baton config set rules '[{"match":{"keywordsAny":["لخص","اشرح"]},"agent":"gemini"}]'
```

## Commands

| Command | What it does |
|---|---|
| `baton run "task"` | route the task, stream the agent, relay on a limit (alias: `baton "task"`) |
| `baton continue` | resume the last task — same agent's own session, or the next agent with the handoff |
| `baton status` | per-agent runs, tokens and cooldowns · `--json` · `--deep` · `--reset` |
| `baton doctor` | what is installed, what needs a login, exact fix commands · `--probe` |
| `baton agents` | adapters, resolved binaries, versions |
| `baton handoff` | write `HANDOFF.md` right now |
| `baton config` | effective config with origins · `get` · `set` (`--global`) |
| `baton init` | write a project config into `.baton/` |

Useful flags on `run`: `--auto` (let the agent edit files), `--unsafe` (reach for the
provider's own bypass mode — loud warning, never a default), `--quiet`, `--verbose`
(echo every raw provider line).

Exit codes: `0` ok · `1` error · `2` usage · `3` every agent exhausted · `130` cancelled.

## Configuration

Defaults → `~/.baton/config.json` → `<project>/.baton/config.json` → flags.
Full reference: **[docs/CONFIG.md](docs/CONFIG.md)** (generated from the schema).

```bash
baton config                              # what is actually in effect, and from where
baton config set chain codex,claude
baton config set agents.gemini.extraArgs -- --skip-trust   # -- ends flag parsing
```

## Trying the relay without burning quota

```bash
BATON_TEST_FORCE_LIMIT=claude baton run "reply with the word ok"
```

Claude reports a simulated limit without being spawned at all, so you can watch the whole
relay — handoff written, baton passed, next agent finishing the task.

The two hooks compose, so you can see the relay with **no provider CLI installed at all**:

```bash
BATON_TEST_FAKE=1 BATON_TEST_FORCE_LIMIT=claude baton run "refactor the payment module"
```

`BATON_TEST_FAKE=1` replaces every adapter with a fake — which is also how the test suite
and the packaging smoke test run a complete task with no account and no network.

## Known limitations (v0.1.0)

- **Limit wordings are partly unverified.** Claude's structured `rate_limit_event` is
  captured from a real run; the text patterns for all three providers are written from
  their documented wording, not from a captured limit — nobody exhausted an account to
  make a fixture. If Baton ever misses a limit, run with `--verbose`, and add the wording
  to `~/.baton/patterns.json` (it extends the built-ins, no update needed).
- **Windows is CI-green but has never been driven by a human.** The matrix (ubuntu,
  macos, windows × Node 22/24) passes, including installing the tarball and running a
  whole task there. What is still missing is one live session on a real Windows machine
  with logged-in provider CLIs.
- **Gemini is stateless.** Its `--resume` takes an index, not a session id, so continuity
  for Gemini always goes through `HANDOFF.md`.
- **One agent at a time.** Baton is a relay, not a swarm. No parallel execution in v1.

## Contributing

`npm run build` · `npm test` · `npm run lint` · `npm run typecheck` · `npm run smoke`.
The specs in [`docs/`](docs/) are normative — when reality and a doc disagree, reality
wins and the doc gets fixed in the same commit. Parsers are only allowed to change
alongside a fixture that proves the format ([`fixtures/README.md`](fixtures/README.md)).

---

Baton is an independent open-source project, not affiliated with or endorsed by
Anthropic, OpenAI, or Google. It orchestrates the official CLIs you installed and
authenticated yourself.

MIT © Ayoub Benderdouch
