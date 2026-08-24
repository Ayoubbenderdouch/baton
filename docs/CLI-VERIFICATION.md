# Verified CLI reality (evidence log)

Rule 7 of the master prompt: *where reality contradicts a doc, trust reality, update the
doc in the same commit, add a fixture*. This file is the evidence trail: what was run,
on which version, and what differed from `docs/ADAPTERS.md` as shipped in the build kit.

## Verification run — 2026-08-24, macOS (darwin 25.3.0), Node v26.7.0

| CLI | Binary | Version |
|---|---|---|
| Claude Code | `/Users/macbook/.local/bin/claude` | `2.1.241` |
| Codex CLI | `/Users/macbook/.local/bin/codex` | `codex-cli 0.147.0` |
| Gemini CLI | `/Users/macbook/.local/bin/gemini` | `0.56.0` |

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
