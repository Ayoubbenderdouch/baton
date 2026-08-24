---
name: baton-ui-style
description: Baton's visual identity and output-writing rules. Use this skill whenever writing or changing ANY user-facing terminal output — run rendering, relay announcements, error messages, help text, doctor/status/agents tables, spinners, colors, or README wording about the brand. Also use it when reviewing a PR that adds a console.log.
---

# Baton UI style

Normative spec: docs/UX-SPEC.md (palette, layouts, command surface). Working rules:

## Identity guardrails
- Violet primary + cyan accent. NEVER an orange/coral primary. NEVER provider logos,
  wordmarks, or lookalike ASCII art. Agent badges are lowercase bracketed tags only.
- Every distribution surface (README, npm description, --help footer) carries the
  non-affiliation disclaimer exactly as written in UX-SPEC.md.

## Output rules
- One rendering module owns all styling (src/ui/). No raw chalk/pc calls sprinkled in
  business logic; core emits events, ui renders them.
- Every error = 3 lines max: what happened → exact fix command → where the log is.
  Stack traces only under --verbose.
- TTY features (spinner, cursor, live rewrite) behind isTTY checks; non-TTY output must
  contain the same information in plain lines. NO_COLOR respected automatically.
- The relay announcement is sacred UX — loud, two lines, exactly per UX-SPEC. Don't
  bury it, don't reword it casually; it's the screenshot people will share.
- Messages are short, active voice, no exclamation-mark spam, no apology theater.
  Numbers over adjectives ("2 files changed", not "some changes").

## Adding a new message
Copy tone from existing messages in src/ui/messages.ts (single source for strings — it
is also what makes future i18n possible). Add it there, never inline.
