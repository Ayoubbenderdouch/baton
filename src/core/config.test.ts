import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  didYouMean,
  loadConfig,
  readRawConfig,
  setByPath,
  writeConfigFile,
} from "./config.js";

const dirs: string[] = [];
function temp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function writeProjectConfig(cwd: string, values: unknown): void {
  mkdirSync(path.join(cwd, ".baton"), { recursive: true });
  writeFileSync(path.join(cwd, ".baton", "config.json"), JSON.stringify(values), "utf8");
}

describe("config merge (default -> global -> project -> flags)", () => {
  it("uses the documented defaults when nothing is configured", async () => {
    const { config, origins } = await loadConfig(temp("baton-cfg-"), {}, temp("baton-home-"));
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(origins.chain).toBe("default");
  });

  it("lets the project override the global, and flags override both", async () => {
    const home = temp("baton-home-");
    const cwd = temp("baton-cfg-");
    writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({ chain: ["gemini", "codex"], maxRelays: 5 }),
      "utf8",
    );
    writeProjectConfig(cwd, { chain: ["codex", "claude"] });

    const merged = await loadConfig(cwd, { permissionLevel: "auto" }, home);
    expect(merged.config.chain).toEqual(["codex", "claude"]);
    expect(merged.config.maxRelays).toBe(5);
    expect(merged.config.permissionLevel).toBe("auto");
    expect(merged.origins.chain).toBe("project");
    expect(merged.origins.maxRelays).toBe("global");
    expect(merged.origins.permissionLevel).toBe("flag");
  });

  it("warns about an unknown key with a did-you-mean and keeps the rest", async () => {
    const cwd = temp("baton-cfg-");
    writeProjectConfig(cwd, { chian: ["codex"], maxRelays: 1 });
    const merged = await loadConfig(cwd, {}, temp("baton-home-"));
    expect(merged.warnings.join(" ")).toContain('unknown key "chian"');
    expect(merged.warnings.join(" ")).toContain('did you mean "chain"');
    expect(merged.config.maxRelays).toBe(1);
  });

  it("rejects an invalid value but keeps the valid keys around it", async () => {
    const cwd = temp("baton-cfg-");
    writeProjectConfig(cwd, { chain: ["kimi"], cooldownMinutes: 15 });
    const merged = await loadConfig(cwd, {}, temp("baton-home-"));
    expect(merged.config.chain).toEqual(DEFAULT_CONFIG.chain);
    expect(merged.config.cooldownMinutes).toBe(15);
    expect(merged.warnings.length).toBeGreaterThan(0);
  });

  it("ignores a corrupt config file instead of failing the command", async () => {
    const cwd = temp("baton-cfg-");
    mkdirSync(path.join(cwd, ".baton"), { recursive: true });
    writeFileSync(path.join(cwd, ".baton", "config.json"), "{oops", "utf8");
    const merged = await loadConfig(cwd, {}, temp("baton-home-"));
    expect(merged.config.chain).toEqual(DEFAULT_CONFIG.chain);
    expect(merged.warnings[0]).toContain("not valid JSON");
  });
});

describe("baton config set (dot paths)", () => {
  it("sets a nested role", () => {
    const raw: Record<string, unknown> = {};
    expect(setByPath(raw, "roles.architect", "codex")).toEqual({ ok: true, value: "codex" });
    expect(raw).toEqual({ roles: { architect: "codex" } });
  });

  it("parses a chain from a comma list", () => {
    const raw: Record<string, unknown> = {};
    setByPath(raw, "chain", "codex,claude");
    expect(raw.chain).toEqual(["codex", "claude"]);
  });

  it("parses numbers and booleans", () => {
    const raw: Record<string, unknown> = {};
    setByPath(raw, "maxRelays", "3");
    setByPath(raw, "relayOnError", "true");
    expect(raw).toEqual({ maxRelays: 3, relayOnError: true });
  });

  it("sets passthrough args for one agent", () => {
    const raw: Record<string, unknown> = {};
    const result = setByPath(raw, "agents.gemini.extraArgs", "--skip-trust");
    expect(result.ok).toBe(true);
    expect(raw).toEqual({ agents: { gemini: { extraArgs: ["--skip-trust"] } } });
  });

  it("refuses an unknown key with a suggestion", () => {
    const result = setByPath({}, "chian", "codex");
    expect(result).toEqual({ ok: false, error: 'unknown key "chian" — did you mean "chain"?' });
  });

  it("refuses an invalid value and leaves nothing half-written", () => {
    const result = setByPath({}, "chain", "kimi");
    expect(result.ok).toBe(false);
  });

  it("round-trips through the file", async () => {
    const cwd = temp("baton-cfg-");
    const file = path.join(cwd, ".baton", "config.json");
    const raw = await readRawConfig(file);
    setByPath(raw, "roles.quick", "codex");
    await writeConfigFile(file, raw);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ roles: { quick: "codex" } });
    const merged = await loadConfig(cwd, {}, temp("baton-home-"));
    expect(merged.config.roles.quick).toBe("codex");
    expect(merged.config.roles.architect).toBe("claude");
  });
});

describe("didYouMean", () => {
  it("suggests only close matches", () => {
    expect(didYouMean("chian", ["chain", "roles"])).toBe("chain");
    expect(didYouMean("completely-different", ["chain", "roles"])).toBeUndefined();
  });
});

describe("values that look like flags", () => {
  it("stores a provider flag as a clean single-element list", () => {
    const raw: Record<string, unknown> = {};
    // The CLI form is `baton config set agents.gemini.extraArgs -- --skip-trust`;
    // `--` ends commander's option parsing, so the value arrives here verbatim.
    expect(setByPath(raw, "agents.gemini.extraArgs", "--skip-trust").ok).toBe(true);
    expect(raw).toEqual({ agents: { gemini: { extraArgs: ["--skip-trust"] } } });
  });

  it("trims stray whitespace instead of passing a broken flag to a provider", () => {
    const raw: Record<string, unknown> = {};
    setByPath(raw, "agents.codex.extraArgs", "  --skip-git-repo-check  ");
    expect(raw).toEqual({ agents: { codex: { extraArgs: ["--skip-git-repo-check"] } } });
  });
})
