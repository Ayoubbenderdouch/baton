---
name: release-checklist
description: Everything required to version, package, and publish baton-ai to npm safely. Use this skill whenever bumping a version, editing CHANGELOG.md, touching package.json fields (bin, files, exports, engines), preparing npm publish or a dry-run, tagging a release, or when the user says "release", "publish", or "ship it".
---

# Release checklist (baton-ai)

## Every release, in order
1. CI green on ubuntu + macos + windows for the release commit. No exceptions.
2. CHANGELOG.md updated: Added/Changed/Fixed, user-language not commit-language.
   Breaking changes (incl. RELAY_PREAMBLE wording) called out at the top.
3. Version bump per semver (pre-1.0: breaking → minor, else patch).
4. `npm pack` → inspect the tarball file list: dist/, README, LICENSE, CHANGELOG only.
   No fixtures, no .baton, no docs/ internals unless intended. `files` field is the
   allowlist — keep it tight.
5. Tarball smoke on a clean temp dir (all 3 OSes via CI job): install → baton --version
   → baton doctor with fake shims.
6. `npm publish --dry-run` reviewed, then publish. Package name is `baton-ai`, bin is
   `baton` — never rename casually; both are public API.
7. Git tag v<version>, GitHub release notes = CHANGELOG section, attach nothing else.

## Package.json invariants
`"type": "module"` · `engines.node: ">=20"` · bin points at the built dist entry with a
shebang · `exports` map present · repository/bugs/homepage filled · keywords include:
cli, ai, agents, claude-code, codex, gemini, orchestrator, rate-limit, failover.

## Never
Publish with a red Windows CI · publish uncommitted work · add postinstall scripts
(instant trust-killer for a security-sensitive audience) · add telemetry of any kind.
