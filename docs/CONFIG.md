# Baton — configuration reference

<!-- generated from the zod schema in src/core/config.ts — run `npm test` to check -->

Config is merged in this order, later layers winning:

1. built-in defaults
2. `~/.baton/config.json` (global)
3. `<project>/.baton/config.json` (project)
4. command-line flags

`roles` and `agents` merge key by key, so setting one role keeps the others.
`chain` and `rules` replace wholesale — their order is their meaning.

```bash
baton config                      # effective config, with the origin of every key
baton config get roles.architect
baton config set chain codex,claude
baton config set roles.analyze codex --global
baton config set agents.gemini.extraArgs --skip-trust
```

| Key | Default | What it does |
|---|---|---|
| `chain` | `["claude","codex","gemini"]` | Failover order. The relay walks this list to find the next agent. |
| `roles` | see below | Role name -> agent, used by `baton run --role architect`. |
| `rules` | see below | Routing rules, evaluated top down; the first match wins. |
| `maxRelays` | `2` | How many times one task may be passed on before Baton stops. |
| `cooldownMinutes` | `30` | How long an agent is skipped after a usage limit (a later provider reset time wins). |
| `permissionLevel` | `"safe"` | safe = read-only tools; auto = the agent may edit files. |
| `relayOnError` | `false` | Also relay on non-limit failures. Off by default, so a broken workspace does not burn a second quota. |
| `runTimeoutMs` | `1200000` | Hard limit for a single agent turn. |
| `stallMs` | `120000` | Silence after which the UI says 'still working' instead of looking frozen. |
| `agents` | `{}` | Passthrough args per agent, e.g. {"gemini":{"extraArgs":["--skip-trust"]}}. |

## Defaults in full

```json
{
  "chain": [
    "claude",
    "codex",
    "gemini"
  ],
  "roles": {
    "architect": "claude",
    "implement": "codex",
    "analyze": "gemini",
    "quick": "gemini"
  },
  "rules": [
    {
      "match": {
        "keywordsAny": [
          "debug",
          "why is",
          "root cause",
          "architecture",
          "design",
          "refactor plan",
          "race condition"
        ]
      },
      "agent": "claude"
    },
    {
      "match": {
        "keywordsAny": [
          "summarize",
          "summarise",
          "explain this repo",
          "read",
          "review",
          "document",
          "changelog"
        ]
      },
      "agent": "gemini"
    },
    {
      "match": {
        "keywordsAny": [
          "implement",
          "add test",
          "write tests",
          "fix lint",
          "rename",
          "migrate",
          "boilerplate"
        ]
      },
      "agent": "codex"
    },
    {
      "match": {
        "promptCharsOver": 6000
      },
      "agent": "gemini"
    },
    {
      "match": {
        "attachedContextCharsOver": 20000
      },
      "agent": "gemini"
    }
  ],
  "maxRelays": 2,
  "cooldownMinutes": 30,
  "permissionLevel": "safe",
  "relayOnError": false,
  "runTimeoutMs": 1200000,
  "stallMs": 120000,
  "agents": {}
}
```

## Limit patterns

`~/.baton/patterns.json` **extends** the built-in limit patterns (it never replaces
them), so new provider wording can be handled the same day it appears:

```json
{
  "claude": [
    "schluss für heute"
  ],
  "gemini": [
    "daily cap"
  ]
}
```

A malformed file or an invalid regex warns once and is ignored — a bad pattern file
never stops a run.
