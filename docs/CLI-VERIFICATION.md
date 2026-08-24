# Verified CLI reality (evidence log)

Rule 7 of the master prompt: *where reality contradicts a doc, trust reality, update the
doc in the same commit, add a fixture*. This file is the evidence trail: what was run,
on which version, and what differed from `docs/ADAPTERS.md` as shipped in the build kit.

## Verification run — 2026-08-24, macOS (darwin 25.3.0), Node v26.7.0

| CLI | Binary | Version |
|---|---|---|
| Claude Code | `~/.local/bin/claude` | `2.1.241` |
| Codex CLI | `~/.local/bin/codex` | `codex-cli 0.147.0` |
| Gemini CLI | `~/.local/bin/gemini` | `0.56.0` |

### Deltas found vs. the kit's ADAPTERS.md

1. **`claude --max-turns <n>` no longer exists** (2.1.241). `claude --help` has no
   `--max-turns` flag at all. → Baton does not pass it. Runaway protection is Baton's own
   `runTimeoutMs`; users who want a turn cap use `agents.claude.extraArgs`.
2. **`codex exec --full-auto` is not a flag of `codex exec`** (0.147.0). The sandbox
   selector is `-s, --sandbox <read-only|workspace-write|danger-full-access>`.
   → `safe` = `--sandbox read-only`, `auto` = `--sandbox workspace-write`,
   `--unsafe` = `--dangerously-bypass-approvals-and-sandbox`.
3. **Claude permission modes grew**: `acceptEdits`, `auto`, `bypassPermissions`,
   `manual`, `dontAsk`, `plan`. Baton uses `acceptEdits` for `auto` and
   `bypassPermissions` only behind `--unsafe`.
4. **Gemini resume is index-based**, not id-based: `-r, --resume <"latest"|index>`.
   Confirms the doc's decision to treat Gemini as stateless in v1 (an index is not a
   stable handle across concurrent projects).
5. Gemini `--output-format` is confirmed as `-o` with `text|json|stream-json`, and
   `--approval-mode default|auto_edit|yolo|plan` plus `-y/--yolo` are confirmed.

Everything else in ADAPTERS.md matched the installed binaries. The deltas above are
folded into `docs/ADAPTERS.md` in the M2/M3 commits that implement each adapter.

## Re-verification — 2026-08-24, release-readiness pass

Same three versions, re-checked flag by flag: every flag Baton actually passes (extracted
from `src/adapters/*/args.ts`) was matched against the installed binaries' own `--help`.

| Provider | Flags checked | Result |
|---|---|---|
| claude 2.1.241 | `-p`, `--output-format stream-json`, `--verbose`, `--permission-mode acceptEdits`, `--allowedTools`, `--resume`, `--dangerously-skip-permissions` | all present |
| codex 0.147.0 | `exec --json`, `--sandbox read-only\|workspace-write`, `--dangerously-bypass-approvals-and-sandbox`, `exec resume` | all present |
| gemini 0.56.0 | `-p`, `-o stream-json`, `--approval-mode plan\|auto_edit\|yolo` | all present |

The two flags Baton deliberately does **not** pass are still absent from the binaries:
`--max-turns` (claude) and `--full-auto` (`codex exec`) — 0 occurrences in either help.

### Antigravity: not applicable on this machine

`antigravity` is not installed (`command -v antigravity` → nothing; no antigravity-like
binary in `~/.local/bin`; nothing in the global npm list). And the premise that would call
for it does not hold here: Gemini CLI 0.56.0 **does** serve this consumer Google account —
`baton doctor --probe` reports `signed in` for all three agents from a trusted git repo,
and live `baton run --agent gemini` turns complete and write files.

An adapter is therefore **not** written: the adapter-development skill forbids a parser
without a fixture captured from the real CLI, and there is no binary here to capture from.
If Google later moves consumer accounts to Antigravity, the work is one folder
(`src/adapters/antigravity/` with `spec.ts`, `args.ts`, `parse.ts`, `index.ts`), a
registry entry and a fixture set — the core stays untouched, which is what the adapter
contract in ARCHITECTURE.md was designed for.

Other agent CLIs seen on this machine but out of scope for v0.1.0: `kimi-cli`, `grok`,
`cursor-agent`, `vibe`.
