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

## Run rendering (TTY)

```
◇ baton run "fix the flaky auth test"
│ router → claude (rule: keyword "fix"…? no → role default architect)   [dim, 1 line]
│
▐ [claude] ─ working ⠋                                    [spinner line, violet bar]
│  reading src/auth/session.test.ts                        [tool events, dim]
│  running: npm test -- auth                               [tool events, dim]
│  The flakiness comes from a shared fixture…              [assistant text, normal]
│
◆ [claude] done in 3m 12s · 2 files changed                [summary line]
```

Relay moment must be **loud and delightful** — it's the product's signature:

```
⚡ [claude] hit its usage limit (resets ~19:00)
🏃 passing the baton → [codex]  (handoff written: HANDOFF.md)
▐ [codex] ─ picking up the task ⠋
```

Non-TTY / `--quiet`: plain lines, prefixed `baton:`, no spinner, same information.
`--verbose`: raw provider events echoed dim, for debugging.

## Errors speak remedy-first

Every failure prints: what happened (1 line) → exact fix command (1 line) → docs link.
`auth` example: `✗ codex: not signed in → run: codex   (then retry baton run)`.
Never dump a stack trace at users unless `--verbose`; log full detail to
`~/.baton/last-error.log` and say so.

## `baton doctor`

Table: agent · installed? (version) · auth probe · verdict, then a summary line
"2/3 ready — baton can relay between claude and gemini." Exit 0 if ≥1 ready.

## Interactive shell (M8, optional)

`baton` with no args opens an Ink-based REPL styled with the same palette: prompt line,
streaming pane, status bar with per-agent availability dots. Ship only after M0–M7 are
green on both OSes; the CLI-first UX above is the product, the shell is dessert.
