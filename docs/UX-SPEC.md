# Baton — UX & visual identity

Goal: the **feel** of a first-class agent CLI (live streaming, spinners, clear turn
structure) with an identity that is unmistakably NOT any provider's brand.

## Hard identity rules

- Product name: **Baton**. Tagline: *"Pass the baton, keep the context."*
- **Palette (fixed):** primary **violet** (#8B5CF6-ish → `pc.magenta`/256-color 135),
  accent **cyan** (#22D3EE-ish), success green, warning yellow, error red, dim gray.
  **Forbidden:** any orange/coral primary (Claude Code's territory) and any provider
  logo, wordmark, or lookalike ASCII art.
- Per-agent badge colors used ONLY to tag output attribution:
  `[claude]` violet, `[codex]` cyan, `[gemini]` green — lowercase, bracketed, subtle.
- README + `--help` footer: "Baton is an independent open-source project, not
  affiliated with or endorsed by Anthropic, OpenAI, or Google. It orchestrates the
  official CLIs you installed and authenticated yourself."

## Command surface

```
baton run "task"        # main entry (alias: baton "task")
baton continue          # resume last task (native resume or relay)
baton status [--json] [--deep]
baton doctor            # detection + auth probes + exact fix commands
baton agents            # table of adapters, versions, availability
baton handoff           # force-write HANDOFF.md now
baton config [get|set]  # effective config, dot-path setter
baton init              # create .baton/ + project config interactively
```

## Layout

Every screen is built from one system, so the interactive shell and `baton run` in a
terminal look the same. The builders live in `src/ui/format.ts` and return finished
lines; Ink only adds boxes around them. Snapshots in `src/ui/__snapshots__/` pin all of
this character for character.

### Idle — `baton` with no task

```
▌ baton  v0.1.0                                                 ~/projects/my-app

╭──────────────────────────────────────────────────────────────────────────────╮
│ ❯ describe a task…                                                           │
╰──────────────────────────────────────────────────────────────────────────────╯

claude ● ready    codex ● ready    gemini ◌ cooling · ~19:00
enter run · tab agent · ctrl+s status · ctrl+d doctor · esc quit
```

- **Header**: one line, never two. Violet half-block, bold `baton`, dim version on the
  left; dim cwd right-aligned, truncated through the middle (`/very/…/my-app`) before the
  line is ever allowed to wrap.
- **Input**: full-width rounded box — the anchor of the screen, so nothing floats loose.
  Border dim when empty, violet once typing starts. Cyan `❯` caret, dim placeholder.
- **Chips**: directly under the input, never in a corner. Name + state dot
  (● green ready · ◌ yellow cooling with its reset hint · ✗ red not signed in, name dim).
  A `tab`-locked agent is bold in its own colour.
- **Hints**: exactly one dim line. Nothing else on screen.
- One blank line between header, input and chips.

### Running

```
❯ fix the flaky auth test
▐ [claude] Sprinting… 12s · 3.1k tokens                        esc to interrupt
⏺ Read src/auth/session.test.ts
⏺ Bash npm test -- auth
  ⎿ 2 passed, 1 failed
    +18 lines (ctrl+r to expand)
The flakiness comes from a shared fixture that resets…
```

- The submitted prompt is echoed once; the input box collapses away and returns when the
  run ends.
- Status line: violet half-block, agent badge in its colour, a present-participle verb
  from a relay-themed rotation (Sprinting, Pacing, Warming up, On the track, Passing,
  Stretching) that changes every ~8s, elapsed time, token count when known, and a
  right-aligned dim `esc to interrupt` that is dropped rather than allowed to overflow.
- Tool lines: `⏺` in the agent's colour, tool name bold, argument summary plain. Results
  nest under `⎿`, dim, three lines until `ctrl+r`.
- Assistant prose renders as markdown — bold, italic, inline code, bullets and fenced code
  blocks with light syntax colouring — wrapped to the terminal width.
- Finished output is frozen in Ink's `<Static>`: history never re-renders, only the status
  line does.

### The relay — the signature moment

```

⚡ [claude] usage limit reached · resets ~19:00
⇥ passing the baton → [codex] · handoff written · HANDOFF.md

```

Two lines, one blank line above and below, `⚡` yellow, the arrow line cyan, both badges in
their own colours. Never dim, never buried.

### Completion and errors

```
◆ done · [claude] · 3m 12s · 2 files changed · session saved
```

```
✗ codex: not signed in
  → run: codex   (then retry)
  log: ~/.baton/last-error.log
```

### status · doctor · agents

Aligned tables with bold dim uppercase headers, column widths computed from real cell
widths (CJK counts 2, zero-width joiners 0), the same state dots as the chips, and one
summary line underneath: `2/3 ready — baton can relay between claude and gemini.`

## Rendering rules

1. **Bold and dim never nest.** They share the reset code `\x1b[22m`, so a nested pair
   loses the outer style. Lines are assembled as pre-painted strings, sequentially.
2. **Width comes from a real width function**, never `.length`. Structure is drawn with
   single-cell glyphs; emoji appear only as accents at the start of a line.
3. **Glyph fallback.** Default set `▌▐ ❯ ⏺ ⎿ ● ◌ ◆ ⚡ ⇥ ✗`; the ASCII profile
   (`| > * L * o * ! -> x`) is chosen automatically on a legacy Windows console (no
   `WT_SESSION`) or `TERM=dumb`, and by `--ascii` / `BATON_ASCII=1`. In that profile even
   the typography in prose degrades (— → -, … → ..., → → ->), so nothing renders as `?`.
4. **Non-TTY and `--quiet`**: the same information as plain `baton:` lines — no spinner,
   no cursor movement, no borders, no colour. `NO_COLOR` is honoured everywhere.
5. **Resize**: the layout follows `stdout` resize events; the input box always fits.
6. **Keys**: enter runs · esc interrupts a run, or quits when idle · ctrl+c twice within
   2s force-quits (the first press says so) · tab cycles the agent override · ctrl+s
   status · ctrl+d doctor · ctrl+r expands tool results. The bindings are one pure
   function (`src/ui/shell/keys.ts`) with its own tests, and the terminal is restored on
   exit — cursor visible, raw mode off.
7. **Performance**: history in `<Static>`; only the status line re-renders; every animated
   element shares one 10fps clock (`src/ui/animation.ts`), so a run costs exactly one
   timer and an idle screen costs none.

## Errors speak remedy-first

Every failure prints: what happened (1 line) → exact fix command (1 line) → docs link.
`auth` example: `✗ codex: not signed in → run: codex   (then retry baton run)`.
Never dump a stack trace at users unless `--verbose`; log full detail to
`~/.baton/last-error.log` and say so.

## `baton doctor`

Table: agent · installed? (version) · auth probe · verdict, then a summary line
"2/3 ready — baton can relay between claude and gemini." Exit 0 if ≥1 ready.

## Slash commands

Typing `/` as the first character opens the command palette, attached under the input
inside the same frame — the input never floats loose while you are choosing:

```
╭──────────────────────────────────────────────────────────────────────╮
│ ❯ /lo                                                                │
│ ──────────────────────────────────────────────────────────────────── │
│ ❯ /login    sign in to a provider (opens its official flow)          │
│   /logout   sign out of a provider                                   │
│ ↑↓ move · tab complete · enter run · esc close                       │
╰──────────────────────────────────────────────────────────────────────╯
```

- Filtering is live per keystroke: prefix matches first, then fuzzy; aliases match too.
  At most 7 rows are shown, and the window follows the selection.
- `↑↓` move · `tab` completes the highlighted name (a second `tab` completes an agent id
  for commands that take one) · `enter` runs · `esc` closes the palette keeping the text,
  `esc` again clears the input.
- An unknown command prints `unknown command /xyz · try /help` and keeps what was typed.
- A command that needs a provider and was run bare asks inline, reusing the chip colours:

```
pick a provider:  ❯ claude   codex   gemini  (↑↓ enter esc)
```

  Providers that cannot be acted on are dim and skipped by the arrows.

### The commands

<!-- generated from src/ui/commands.ts — run `npm test` to check -->

| Command | What it does | Alias |
|---|---|---|
| `/help` | list the commands | /? |
| `/agents` | which agent CLIs are installed |  |
| `/doctor` | check installs and sign-ins (costs one request per agent) |  |
| `/status` | usage and cooldowns across every agent |  |
| `/login [agent]` | sign in to a provider (opens its official flow) |  |
| `/logout [agent]` | sign out of a provider |  |
| `/model [agent] [name|clear]` | show or set the model passed through to a provider |  |
| `/agent <id|auto>` | lock the next run to one agent, or hand it back to the router |  |
| `/chain <a,b[,c]>` | set the failover order for this project |  |
| `/role <name>` | route the next run by role |  |
| `/permissions [safe|auto]` | show or set what agents may do to your files |  |
| `/handoff` | write HANDOFF.md right now |  |
| `/continue` | pick the last task back up |  |
| `/config` | show the effective config and where each value came from |  |
| `/init` | create .baton/ with a project config |  |
| `/clear` | clear the transcript on screen |  |
| `/quit` | leave baton | /exit |

### `/login` and `/logout` never touch a credential

They spawn the provider's **own** command — `claude auth login`, `codex login`, or the
Gemini CLI itself when it has no auth subcommand — with a resolved binary, an args array
and inherited stdio. Baton clears its frame, leaves raw mode, lets the child own the
terminal, and takes it back when the child exits: it then re-runs detection, refreshes the
chips and prints one line (`✓ codex signed in`, or the three-line remedy-first error).
Ctrl+C during the child kills the child alone; Baton ignores SIGINT for that stretch and
redraws afterwards.

### `/model` passes through, it never knows better

It shows or sets `agents.<id>.extraArgs`, written as two argv elements (`--model`, name)
because one string with a space is not a flag any CLI accepts. Baton ships **no list of
model names** — they go stale — and says so: *passed through as `--model`; the provider
checks it on the next run*. `/model <agent> clear` removes the override.

## Interactive shell

`baton` with no task opens the shell described above. It **never performs
authentication**: an agent that is not signed in shows the provider's own command, and
`[r]` re-checks. That keeps ARCHITECTURE.md's non-goal ("no wrapping of provider auth
flows") intact, and a test renders the screen and fails if the words "password", "api key"
or "log you in" ever appear on it. Verifying logins stays behind `[p]`, because it costs
one request per agent.

A pipe or CI never opens the shell — `baton` falls back to the usage message.
