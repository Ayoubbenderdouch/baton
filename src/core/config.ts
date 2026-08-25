import path from "node:path";
import { z } from "zod";
import { batonHome, projectBatonDir, readTextFile, writeFileAtomic } from "./paths.js";
import { AGENT_IDS, type AgentId } from "./types.js";

const agentIdSchema = z.enum(["claude", "codex", "gemini"]);

const ruleSchema = z
  .object({
    match: z
      .object({
        keywordsAny: z.array(z.string()).optional(),
        promptCharsOver: z.number().int().positive().optional(),
        attachedContextCharsOver: z.number().int().positive().optional(),
      })
      .strict(),
    agent: agentIdSchema,
  })
  .strict();

export const configSchema = z
  .object({
    chain: z
      .array(agentIdSchema)
      .min(1)
      .describe("Failover order. The relay walks this list to find the next agent."),
    roles: z
      .record(z.string(), agentIdSchema)
      .describe("Role name -> agent, used by `baton run --role architect`."),
    rules: z
      .array(ruleSchema)
      .describe("Routing rules, evaluated top down; the first match wins."),
    maxRelays: z
      .number()
      .int()
      .min(0)
      .describe("How many times one task may be passed on before Baton stops."),
    cooldownMinutes: z
      .number()
      .int()
      .min(0)
      .describe(
        "How long an agent is skipped after a usage limit (a later provider reset time wins).",
      ),
    permissionLevel: z
      .enum(["safe", "auto"])
      .describe("safe = read-only tools; auto = the agent may edit files."),
    relayOnError: z
      .boolean()
      .describe("Also relay on non-limit failures. Off by default, so a broken workspace does not burn a second quota."),
    runTimeoutMs: z.number().int().positive().describe("Hard limit for a single agent turn."),
    stallMs: z
      .number()
      .int()
      .positive()
      .describe("Silence after which the UI says 'still working' instead of looking frozen."),
    agents: z
      .partialRecord(agentIdSchema, z.object({ extraArgs: z.array(z.string()) }).strict())
      .describe(
        "Passthrough args per agent, e.g. {\"gemini\":{\"extraArgs\":[\"--skip-trust\"]}}.",
      ),
  })
  .strict();

export type BatonConfig = z.infer<typeof configSchema>;

/**
 * Defaults per docs/ROUTING.md: spend the scarcest limits on the hardest work.
 * Claude Max hours go to architecture and debugging, ChatGPT turns to implementation
 * volume, the Google account absorbs long-context reading and small questions.
 */
export const DEFAULT_CONFIG: BatonConfig = {
  chain: ["claude", "codex", "gemini"],
  roles: {
    architect: "claude",
    implement: "codex",
    analyze: "gemini",
    quick: "gemini",
  },
  rules: [
    {
      match: {
        keywordsAny: [
          "debug",
          "why is",
          "root cause",
          "architecture",
          "design",
          "refactor plan",
          "race condition",
        ],
      },
      agent: "claude",
    },
    {
      match: {
        keywordsAny: [
          "summarize",
          "summarise",
          "explain this repo",
          "read",
          "review",
          "document",
          "changelog",
        ],
      },
      agent: "gemini",
    },
    {
      match: {
        keywordsAny: [
          "implement",
          "add test",
          "write tests",
          "fix lint",
          "rename",
          "migrate",
          "boilerplate",
        ],
      },
      agent: "codex",
    },
    { match: { promptCharsOver: 6000 }, agent: "gemini" },
    { match: { attachedContextCharsOver: 20000 }, agent: "gemini" },
  ],
  maxRelays: 2,
  cooldownMinutes: 30,
  permissionLevel: "safe",
  relayOnError: false,
  runTimeoutMs: 20 * 60 * 1000,
  stallMs: 120_000,
  agents: {},
};

export type ConfigOrigin = "default" | "global" | "project" | "flag";

export interface EffectiveConfig {
  config: BatonConfig;
  /** Where each top-level key's value came from — `baton config` prints this. */
  origins: Record<string, ConfigOrigin>;
  warnings: string[];
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distance: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) (distance[i] as number[])[0] = i;
  for (let j = 0; j < cols; j += 1) (distance[0] as number[])[j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      (distance[i] as number[])[j] = Math.min(
        ((distance[i - 1] as number[])[j] as number) + 1,
        ((distance[i] as number[])[j - 1] as number) + 1,
        ((distance[i - 1] as number[])[j - 1] as number) + cost,
      );
    }
  }
  return (distance[a.length] as number[])[b.length] as number;
}

export function didYouMean(unknownKey: string, known: string[]): string | undefined {
  let best: { key: string; distance: number } | undefined;
  for (const key of known) {
    const distance = levenshtein(unknownKey.toLowerCase(), key.toLowerCase());
    if (best === undefined || distance < best.distance) best = { key, distance };
  }
  return best !== undefined && best.distance <= 3 ? best.key : undefined;
}

export const CONFIG_KEYS = Object.keys(configSchema.shape);

export interface LoadedLayer {
  values: Partial<BatonConfig>;
  warnings: string[];
}

/** Read one config file, tolerating absence; a bad file warns and is skipped. */
export async function readConfigLayer(file: string): Promise<LoadedLayer> {
  const raw = await readTextFile(file);
  if (raw === undefined) return { values: {}, warnings: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { values: {}, warnings: [`${file}: not valid JSON — ignored`] };
  }
  const result = configSchema.partial().safeParse(parsed);
  if (result.success) return { values: result.data, warnings: [] };

  const warnings: string[] = [];
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (issue.code === "unrecognized_keys") {
      for (const unknownKey of (issue as { keys: string[] }).keys) {
        const suggestion = didYouMean(unknownKey, CONFIG_KEYS);
        warnings.push(
          `${file}: unknown key "${unknownKey}"${suggestion ? ` — did you mean "${suggestion}"?` : ""}`,
        );
      }
      continue;
    }
    warnings.push(`${file}: ${String(key ?? "config")} — ${issue.message}`);
  }
  // Keep whatever parses so one bad key cannot wipe a whole config file.
  const salvaged: Partial<BatonConfig> = {};
  if (typeof parsed === "object" && parsed !== null) {
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const shape = configSchema.shape as Record<string, z.ZodTypeAny>;
      const keySchema = shape[key];
      if (keySchema === undefined) continue;
      const single = keySchema.safeParse(value);
      if (single.success) {
        (salvaged as Record<string, unknown>)[key] = single.data;
      }
    }
  }
  return { values: salvaged, warnings };
}

export function globalConfigPath(home: string = batonHome()): string {
  return path.join(home, "config.json");
}

export function projectConfigPath(cwd: string): string {
  return path.join(projectBatonDir(cwd), "config.json");
}

/** defaults → global → project → flags, with the origin of every key recorded. */
export async function loadConfig(
  cwd: string,
  flags: Partial<BatonConfig> = {},
  home: string = batonHome(),
): Promise<EffectiveConfig> {
  const config: BatonConfig = structuredClone(DEFAULT_CONFIG);
  const origins: Record<string, ConfigOrigin> = {};
  for (const key of CONFIG_KEYS) origins[key] = "default";
  const warnings: string[] = [];

  const layers: [ConfigOrigin, LoadedLayer][] = [
    ["global", await readConfigLayer(globalConfigPath(home))],
    ["project", await readConfigLayer(projectConfigPath(cwd))],
    ["flag", { values: flags, warnings: [] }],
  ];

  // `roles` and `agents` merge key by key: setting one role must not silently drop the
  // others. Arrays (chain, rules) replace wholesale — their order is the meaning.
  const MERGED_KEYS = new Set(["roles", "agents"]);

  for (const [origin, layer] of layers) {
    warnings.push(...layer.warnings);
    for (const [key, value] of Object.entries(layer.values)) {
      if (value === undefined) continue;
      if (MERGED_KEYS.has(key) && typeof value === "object" && !Array.isArray(value)) {
        (config as Record<string, unknown>)[key] = {
          ...((config as Record<string, unknown>)[key] as Record<string, unknown>),
          ...(value as Record<string, unknown>),
        };
      } else {
        (config as Record<string, unknown>)[key] = value;
      }
      origins[key] = origin;
    }
  }

  return { config, origins, warnings };
}

/**
 * Assign an already-typed value at a dot path and validate the result.
 * Used where the caller knows the shape — passing "--model x" through the string parser
 * would produce ONE argv element with a space in it, which no CLI accepts.
 */
export function setByPathValue(
  target: Record<string, unknown>,
  dotPath: string,
  value: unknown,
): { ok: true } | { ok: false; error: string } {
  const parts = dotPath.split(".").filter((part) => part !== "");
  const head = parts[0];
  if (head === undefined || !CONFIG_KEYS.includes(head)) {
    return { ok: false, error: `unknown key "${head ?? ""}"` };
  }
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index] as string;
    const next = cursor[part];
    if (typeof next !== "object" || next === null || Array.isArray(next)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1] as string] = value;

  const validated = configSchema.partial().safeParse(target);
  if (validated.success) return { ok: true };
  const issue = validated.error.issues[0];
  return { ok: false, error: issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid value" };
}

/** Dot-path setter for `baton config set roles.architect codex`. */
export function setByPath(
  target: Record<string, unknown>,
  dotPath: string,
  rawValue: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const parts = dotPath.split(".").filter((part) => part !== "");
  const head = parts[0];
  if (head === undefined) return { ok: false, error: "missing key" };
  if (!CONFIG_KEYS.includes(head)) {
    const suggestion = didYouMean(head, CONFIG_KEYS);
    return {
      ok: false,
      error: `unknown key "${head}"${suggestion ? ` — did you mean "${suggestion}"?` : ""}`,
    };
  }

  const leaf = parts[parts.length - 1] as string;
  const assign = (value: unknown): void => {
    let cursor: Record<string, unknown> = target;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index] as string;
      const next = cursor[part];
      if (typeof next !== "object" || next === null || Array.isArray(next)) cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[leaf] = value;
  };

  const candidates: unknown[] = [parseValue(head, parts.length === 1, rawValue)];
  // A field that wants a list (agents.<id>.extraArgs) still accepts a single value.
  if (!Array.isArray(candidates[0])) candidates.push([candidates[0]]);

  let lastError = "invalid value";
  for (const candidate of candidates) {
    assign(candidate);
    const validated = configSchema.partial().safeParse(target);
    if (validated.success) return { ok: true, value: candidate };
    const issue = validated.error.issues[0];
    lastError = issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid value";
  }
  delete (target as Record<string, unknown>)[head];
  return { ok: false, error: lastError };
}

function parseValue(head: string, isTopLevel: boolean, rawInput: string): unknown {
  // A stray space would be passed straight to a provider CLI as part of the flag.
  const raw = rawInput.trim();
  if (isTopLevel && (head === "chain" || head === "rules")) {
    if (head === "chain") return raw.split(",").map((part) => part.trim()).filter(Boolean);
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (raw.includes(",")) return raw.split(",").map((part) => part.trim()).filter(Boolean);
  return raw;
}

export async function writeConfigFile(file: string, values: Record<string, unknown>): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(values, null, 2)}\n`);
}

export async function readRawConfig(file: string): Promise<Record<string, unknown>> {
  const raw = await readTextFile(file);
  if (raw === undefined) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const KNOWN_AGENTS: readonly AgentId[] = AGENT_IDS;
