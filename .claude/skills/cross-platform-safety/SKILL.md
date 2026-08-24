---
name: cross-platform-safety
description: Mandatory rules for Windows + macOS correctness. Use this skill whenever writing or reviewing code that spawns processes, kills processes, touches the filesystem, builds paths, reads env vars or the home directory, parses streams line-by-line, prints to the terminal, or handles Ctrl+C — in ANY file. Also use it when a CI failure appears only on windows-latest.
---

# Cross-platform safety

Read docs/CROSS-PLATFORM.md once fully; this is the working checklist.

## Spawning
- execa with `(resolvedBin, argsArray)`; never a shell string; never `shell: true`.
- Resolve binaries with `resolveBin()` (PATHEXT-aware). Do not call bare names on
  Windows and hope.
- Kill = whole tree: taskkill /T /F on win32, process-group elsewhere. After any change
  to spawning/cancel, manually verify Ctrl+C leaves zero orphans on both OSes.

## Paths & FS
- node:path only; os.homedir(); honor BATON_HOME. No string concatenation of paths.
- All state writes through writeFileAtomic() (tmp + rename, Windows fallback).
- utf8 explicit everywhere. Keep generated paths short (<200 chars total).

## Streams & text
- Line-split with /\r?\n/ always. Strip a trailing \r before JSON.parse on JSONL.
- Arabic/emoji fixture must pass through the pipeline in tests — if you touched
  encoding-adjacent code, watch that test on Windows CI before merging.

## Terminal
- Feature-detect: isTTY, NO_COLOR. Spinners/cursor tricks TTY-only. Alignment must not
  depend on emoji width.

## Red flags to reject in review
`exec(` with a template string · `"/"` or `"\\"` in a path literal · `process.env.HOME`
directly · `.replace("\n"` on stream data · platform check written as
`process.platform === "win32" ? hack : realCode` without a comment explaining why.
