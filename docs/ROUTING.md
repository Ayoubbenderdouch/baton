# Baton — Router (task → agent)

The Router decides which agent starts a task. v1 is **deterministic heuristics only** —
no LLM classification (that's a v2 experiment). Predictability beats cleverness here:
users must be able to answer "why did it pick codex?" from the docs.

## Resolution order (first hit wins)

1. **Explicit flag:** `baton run --agent gemini "…"` — always obeyed (even if cooling
   down; warn but obey).
2. **Role flag:** `baton run --role architect "…"` — role → agent via the roles map.
3. **Rules:** first matching rule in config order.
4. **Chain head:** first available agent of the failover chain.

## Default roles map (config: `roles`)

```jsonc
{
  "architect":  "claude",   // hard design, tricky debugging, multi-file reasoning
  "implement":  "codex",    // scoped feature work, refactors, test writing
  "analyze":    "gemini",   // long-context reading, summaries, docs, reviews
  "quick":      "gemini"    // cheap small asks — protect the paid limits
}
```

Rationale to document in README: route so that the **scarcest limits are spent on the
hardest work**. Claude Max hours go to architecture/debugging; ChatGPT turns go to
implementation volume; the Google account absorbs long-context reading and small
questions. Users remap freely — these are defaults, not opinions Baton enforces.

## Default rules (config: `rules`, evaluated top-down)

```jsonc
[
  { "match": { "keywordsAny": ["debug", "why is", "root cause", "architecture",
               "design", "refactor plan", "race condition"] },      "agent": "claude" },
  { "match": { "keywordsAny": ["summarize", "explain this repo", "read", "review",
               "document", "changelog"] },                          "agent": "gemini" },
  { "match": { "keywordsAny": ["implement", "add test", "write tests", "fix lint",
               "rename", "migrate", "boilerplate"] },               "agent": "codex" },
  { "match": { "promptCharsOver": 6000 },                           "agent": "gemini" },
  { "match": { "attachedContextCharsOver": 20000 },                 "agent": "gemini" }
]
```

Matching is lowercase substring for keywords (no NLP), plus simple size thresholds.
Keywords ship in English; users add their own languages via config (document an Arabic
example in the README — the maintainer's audience will love it).

## Availability filter

Whatever the router picks is filtered through: detected? not cooling down? If filtered
out, fall to the next resolution step and tell the user in one line:
`○ claude is cooling down (resets ~7pm) → starting with codex`.

## Config commands

- `baton config` — print effective merged config (global → project → flags) with origins.
- `baton config set roles.architect codex` / `baton config set chain claude,gemini` —
  dot-path setter writing to the project `.baton/config.json` (`--global` for home).
- Validation via zod; unknown keys are errors with a "did you mean" hint.
