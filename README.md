# 🏃 Baton

**Pass the baton, keep the context.**

Baton runs the official AI coding CLIs you already pay for — Claude Code, Codex CLI,
Gemini CLI — as headless child processes, picks the best-suited one for each task, and
when a provider hits its usage limit it writes a `HANDOFF.md` briefing and relays the
same task to the next provider automatically. One task, one context, zero restarts.

```bash
npm i -g baton-ai
baton doctor
baton run "fix the flaky auth test"
```

> **Status:** in development. See `docs/MILESTONES.md`.

## Baton never touches your credentials

Baton reads, stores, transmits and manages exactly zero tokens, API keys and auth
files. It spawns the official CLIs you installed and logged into yourself, and it makes
no network calls of its own. No telemetry, no update checks, no postinstall scripts.

---

Baton is an independent open-source project, not affiliated with or endorsed by
Anthropic, OpenAI, or Google. It orchestrates the official CLIs you installed and
authenticated yourself.

MIT © Ayoub Benderdouch
