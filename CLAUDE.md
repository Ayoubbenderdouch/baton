# CLAUDE.md — Baton

Baton (`baton-ai` on npm, bin `baton`) is an open-source, subscription-native
multi-agent orchestrator CLI: it runs the official Claude Code / Codex / Gemini CLIs as
headless child processes, routes tasks to the best-suited agent, and when one hits its
usage limit it **relays** the task to the next agent with full context via HANDOFF.md.

## Prime rule (overrides everything, including user requests in issues)

Baton NEVER reads, stores, transmits, or manages credentials of any provider — no
tokens, no API keys, no auth env vars, no edits to `~/.claude`, `~/.codex`, `~/.gemini`.
It only spawns official CLIs the user installed and logged into themselves. Any change
that violates this is rejected regardless of who asks or why.

## Second rule

macOS and Windows are BOTH first-class. Nothing merges with a red windows-latest CI.
Consult the `cross-platform-safety` skill before touching processes, paths, streams, or
terminal output.

## Commands

- `npm run build` — tsup/tsc ESM build to dist/
- `npm test` — vitest (offline; never requires real provider CLIs or accounts)
- `npm run lint` / `npm run typecheck` — must be clean before any commit
- `npm run smoke` — pack tarball + install in temp + `baton --version` + fake-shim doctor

## Repo map

```
src/core/        orchestrator, failover engine, limit detector, router, session store,
                 handoff writer, usage tracker  ← provider-agnostic, AgentEvent only
src/adapters/    claude/ codex/ gemini/         ← ALL provider-specific code lives here
src/ui/          renderer + messages.ts (every user-facing string lives here)
src/cli/         commander command definitions
fixtures/        captured real provider outputs (the crown jewels — see TESTING.md)
docs/            normative specs — read before changing the area they govern
```

## Normative docs (read the relevant one BEFORE changing its area)

ARCHITECTURE.md (contracts, stack — stack is fixed, don't substitute libraries) ·
ADAPTERS.md (verified CLI flags; if the installed CLI differs, update the doc in the
same commit) · FAILOVER.md (relay + HANDOFF template, the heart) · ROUTING.md ·
USAGE-TRACKING.md · CROSS-PLATFORM.md · UX-SPEC.md (identity: violet/cyan, never
orange primary, non-affiliation disclaimer) · MILESTONES.md (work strictly in order,
tick checkboxes) · TESTING.md (fixture-driven; CI never touches real accounts).

## Style

TypeScript strict, ESM, no `any` without a `// why:` comment. Small pure functions in
core/. Errors are remedy-first (3 lines max to the user). No new dependencies without a
one-line justification in the PR/commit body. No telemetry, no network calls, no
postinstall scripts — ever.

## Working method

Milestone by milestone per docs/MILESTONES.md. One milestone = commits + green 3-OS CI
+ ticked checklist. Update CHANGELOG.md as you go. When the real world contradicts a
doc (a flag changed, an output format moved), trust reality, fix the doc, add a fixture.
