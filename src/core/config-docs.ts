import type { z } from "zod";
import { CONFIG_KEYS, DEFAULT_CONFIG, configSchema } from "./config.js";

/**
 * docs/CONFIG.md is generated from the schema itself, so the reference cannot drift
 * away from what the code accepts. A test regenerates it and fails on any difference.
 */
export function renderConfigReference(): string {
  const shape = configSchema.shape as Record<string, z.ZodTypeAny>;
  const rows = CONFIG_KEYS.map((key) => {
    const description = shape[key]?.description ?? "";
    const value = (DEFAULT_CONFIG as Record<string, unknown>)[key];
    const rendered = JSON.stringify(value);
    const short = rendered !== undefined && rendered.length > 60 ? "see below" : `\`${rendered}\``;
    return `| \`${key}\` | ${short} | ${description} |`;
  });

  return [
    "# Baton — configuration reference",
    "",
    "<!-- generated from the zod schema in src/core/config.ts — run `npm test` to check -->",
    "",
    "Config is merged in this order, later layers winning:",
    "",
    "1. built-in defaults",
    "2. `~/.baton/config.json` (global)",
    "3. `<project>/.baton/config.json` (project)",
    "4. command-line flags",
    "",
    "`roles` and `agents` merge key by key, so setting one role keeps the others.",
    "`chain` and `rules` replace wholesale — their order is their meaning.",
    "",
    "```bash",
    "baton config                      # effective config, with the origin of every key",
    "baton config get roles.architect",
    "baton config set chain codex,claude",
    "baton config set roles.analyze codex --global",
    'baton config set agents.gemini.extraArgs --skip-trust',
    "```",
    "",
    "| Key | Default | What it does |",
    "|---|---|---|",
    ...rows,
    "",
    "## Defaults in full",
    "",
    "```json",
    JSON.stringify(DEFAULT_CONFIG, null, 2),
    "```",
    "",
    "## Limit patterns",
    "",
    "`~/.baton/patterns.json` **extends** the built-in limit patterns (it never replaces",
    "them), so new provider wording can be handled the same day it appears:",
    "",
    "```json",
    JSON.stringify({ claude: ["schluss für heute"], gemini: ["daily cap"] }, null, 2),
    "```",
    "",
    "A malformed file or an invalid regex warns once and is ignored — a bad pattern file",
    "never stops a run.",
    "",
  ].join("\n");
}
