---
name: failover-detection
description: How Baton detects usage limits and runs the relay safely. Use this skill whenever editing the LimitDetector, adding or changing a limit/error regex pattern, touching patterns.json handling, the cooldown ledger, the FailoverEngine relay loop, maxRelays/loop-protection, or when a user reports "baton didn't switch" or "baton switched when it shouldn't".
---

# Failover & limit detection

Normative spec: docs/FAILOVER.md. This is the working discipline around it.

## Pattern hygiene (the rules that keep this maintainable)
- A default pattern may only be added together with a fixture file containing the real
  provider output it matches, plus a test asserting the match. No fixture → rejected.
- Patterns are case-insensitive, matched against BOTH stdout and stderr, and scoped per
  provider. Never add a pattern so broad it matches normal assistant prose (e.g. the
  bare word "limit" — an agent explaining rate limits would trigger it). Test each new
  pattern against the ok-stream fixtures too: zero false positives required.
- User patterns from ~/.baton/patterns.json EXTEND defaults. Malformed user file →
  warn once, ignore, continue with defaults. Never crash.

## Classification discipline
- limit → relay eligible. auth / not_installed → never relay; print the provider's own
  fix command. unknown/crash → stop by default; relay only under --relay-on-error.
- When unsure between limit and unknown, prefer unknown. A wrong relay burns a second
  provider's quota on a broken workspace; a wrong stop costs one manual command.

## Relay loop safety invariants (test all of them)
- maxRelays honored · never relay to an agent already limited for this task · cooldown
  respected · chain filtering excludes undetected agents · HANDOFF.md written BEFORE the
  next spawn · partial turn persisted with endedBy:"limit" even if the relay then fails.

## Reproducing without burning quota
Use BATON_TEST_FORCE_LIMIT=<agent> and the FakeAdapter scripts. Never write a test that
needs a real account to be rate-limited.
