# Baton — Cross-platform requirements (macOS + Windows are BOTH first-class)

Windows is not a port target — it ships in v1 with the same features, and CI blocks any
merge that breaks it. Linux comes free with the same rules.

## Process spawning (the #1 source of Windows bugs)

- Use **execa** with `(binary, argsArray)` — **never** a single shell string, never
  `shell: true` with any user-influenced content (command injection + quoting hell).
- Global npm CLIs on Windows are `.cmd`/`.ps1` shims. Resolve the real invocable:
  implement `resolveBin(name)` that walks `PATH` honoring **`PATHEXT`**
  (`.COM;.EXE;.BAT;.CMD;…`) on Windows and plain executability elsewhere; pass the
  resolved path to execa. Verify in CI that `claude`, `codex`, `gemini` fake shims
  resolve on windows-latest (create fake `.cmd` fixtures in a temp PATH dir — do NOT
  install the real CLIs in CI).
- Cancellation: killing the child must kill its whole tree. Use execa's cleanup plus an
  explicit tree kill (`taskkill /pid <pid> /T /F` on Windows; process-group signal
  elsewhere). `Ctrl+C` must leave no orphan `node`/provider processes — test manually
  on both OSes at M2.
- Env: pass through the parent env untouched (the provider CLIs need their own vars);
  add nothing auth-related, ever.

## Paths & files

- `node:path` everywhere (`join`, `resolve`); zero hardcoded `/` or `\\`.
- Home = `os.homedir()`; allow `BATON_HOME` env override (tests use it).
- Config/state writes are **atomic**: write `file.tmp` then `rename` (Windows rename
  over an existing file needs the unlink-first fallback — wrap in `writeFileAtomic()`).
- Watch for path length >260 chars on Windows: keep generated paths short; don't nest
  deep temp dirs.
- Always `{ encoding: "utf8" }`; never rely on platform default.

## Text & streams

- Split stream lines with `/\r?\n/` — JSONL from any provider may arrive with `\r\n`.
- Normalize `\n` when writing HANDOFF.md/session files (git-friendly), but never
  "fix" line endings inside user project files.
- Unicode output (Arabic in prompts!) must survive: test a fixture prompt containing
  Arabic + emoji through the whole pipeline on Windows CI (PowerShell defaults can
  mangle codepages — set `chcp 65001`-independent handling by never round-tripping
  through a shell).

## Terminal / rendering

- Color via picocolors (respects `NO_COLOR`, dumb terminals). Non-TTY (`!stdout.isTTY`)
  → plain sequential output, no spinner, no cursor moves.
- Spinners/`ora` only when TTY. Windows Terminal handles ANSI fine; legacy conhost may
  not — degrade silently, never print raw escape codes.
- Badges use text + color, not emoji-dependent layout (emoji width breaks alignment on
  some Windows fonts). Emoji allowed as accents only.

## CI matrix (non-negotiable)

`.github/workflows/ci.yml`: `os: [ubuntu-latest, macos-latest, windows-latest]`,
Node 20 + 22. Steps: install → lint → typecheck → unit tests → pack smoke
(`npm pack` + install the tarball in a temp dir + `baton --version` + `baton doctor`
with fake shims). All three OSes required for merge.

## Definition of "cross-platform done" per milestone

A milestone is not complete until its features pass on windows-latest in CI **and** the
milestone checklist in MILESTONES.md is ticked for both platforms.
