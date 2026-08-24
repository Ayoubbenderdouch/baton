# MASTER PROMPT — paste this into Claude Code in the prepared repo

(Setup first: empty git repo containing CLAUDE.md, docs/, and .claude/ from this kit —
see README-KIT. Then start Claude Code in that folder and paste everything below.)

---

You are building **Baton** from scratch in this repository: an open-source,
cross-platform (macOS + Windows + Linux) CLI, published to npm as **`baton-ai`** with
the binary **`baton`**, MIT licensed.

**What Baton is, in one paragraph:** a subscription-native multi-agent orchestrator.
Developers who own AI coding subscriptions (Claude Max → Claude Code, ChatGPT →
Codex CLI, Google → Gemini CLI) run `baton run "task"`. Baton picks the best-suited
official CLI, spawns it headless as a child process, streams its work beautifully, and
— the signature feature — when that provider hits its usage limit, Baton writes a
HANDOFF.md briefing and automatically relays the same task to the next provider with
full context. One task, one context, zero restarts. Plus `baton status`: one unified
usage view across all providers.

**What Baton is NOT:** it is not a proxy, not an API client, and it never touches
authentication. It only orchestrates official CLIs the user installed and logged into
themselves. This keeps every user's account 100% within each provider's terms.

## Hard constraints — non-negotiable, re-read before every milestone

1. **Zero credential contact.** Never read/store/transmit/manage tokens, API keys, or
   auth config of any provider. Never set auth env vars. Never modify `~/.claude`,
   `~/.codex`, `~/.gemini`. If a feature seems to need this: the feature is wrong.
2. **Zero network calls from Baton itself.** No telemetry, no update checks, no
   fetches. The only processes contacting providers are their own official CLIs.
3. **Windows and macOS are equal citizens.** Follow docs/CROSS-PLATFORM.md and the
   `cross-platform-safety` skill. Red windows-latest CI = milestone not done.
4. **Distinct identity.** Violet/cyan palette, name "Baton", the non-affiliation
   disclaimer everywhere per docs/UX-SPEC.md. No provider branding, no orange primary,
   no lookalike UI copying beyond the general genre of agent CLIs.
5. **Unsafe modes are opt-in only.** Provider bypass flags (`--dangerously-*`,
   yolo-class) are reachable only through Baton's explicit `--unsafe` with a warning.
6. **Fixture-driven honesty.** CI never requires real provider CLIs, accounts, or
   networks. Every parser and every limit pattern is proven by a captured fixture.
7. **The specs in docs/ are normative.** Where reality (the actually-installed CLIs)
   contradicts a doc, trust reality, update the doc in the same commit, add a fixture.

## How to work

1. Read **CLAUDE.md**, then skim all files in **docs/** (ARCHITECTURE, ADAPTERS,
   ROUTING, FAILOVER, USAGE-TRACKING, CROSS-PLATFORM, UX-SPEC, MILESTONES, TESTING).
   The project skills in `.claude/skills/` will guide specific areas — use them.
2. Execute **docs/MILESTONES.md strictly in order (M0 → M8)**. For each milestone:
   plan briefly → implement → tests green locally → tick its checkboxes in
   MILESTONES.md → conventional commit(s) (`feat(m2): …`) → move on. Never build ahead
   of a red milestone.
3. Before implementing each adapter (M2/M3), run the real installed CLI's help
   (`claude --help`, `codex exec --help`, `gemini --help`) and reconcile with
   docs/ADAPTERS.md. Capture cheap real outputs as fixtures (sanitize personal data).
4. Maintain CHANGELOG.md from M0. Write the README at M8 per the checklist (including
   the Arabic quickstart in docs/README.ar.md).
5. When you need a decision the docs don't cover: choose the option that best serves
   the prime rule and cross-platform equality, note it in the commit body, continue.
   Do not stop to ask for preferences on minor matters.
6. Non-interactive discipline: never leave a milestone half-done with "let me know if
   you want me to continue" — finish the milestone or report a concrete blocker.

## Definition of done for v0.1.0 (the whole task)

- All M0–M7 checkboxes ticked (M8's Ink shell is optional; everything else in M8 is
  required), CI green on ubuntu/macos/windows.
- A fresh user on either OS can: `npm i -g baton-ai` → `baton doctor` → `baton run
  "task"` → watch a live-streamed run → hit a (test-forced) limit → see the relay
  announcement → find HANDOFF.md written → `baton status` shows the session.
- `npm publish --dry-run` clean. Tag v0.1.0 prepared (do not actually publish — the
  maintainer publishes manually).

Begin now with M0. State your short plan for M0, then build it.
