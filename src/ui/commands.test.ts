import { describe, expect, it } from "vitest";
import { COMMANDS, filterCommands, findCommand, parseCommandLine } from "./commands.js";

describe("the registry itself", () => {
  it("has a description and a handler for every command", () => {
    for (const command of COMMANDS) {
      expect(command.description.trim(), command.id).not.toBe("");
      expect(typeof command.handler, command.id).toBe("function");
      expect(command.id).toMatch(/^[a-z]+$/);
    }
  });

  it("keeps ids and aliases unique across the whole set", () => {
    const names = COMMANDS.flatMap((command) => [command.id, ...(command.aliases ?? [])]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("carries the commands the shell promises", () => {
    const ids = COMMANDS.map((command) => command.id);
    for (const id of [
      "help", "agents", "doctor", "status", "login", "logout", "model", "agent",
      "chain", "role", "handoff", "continue", "config", "init", "permissions",
      "clear", "quit",
    ]) {
      expect(ids, `/${id} is missing`).toContain(id);
    }
  });
});

describe("lookup", () => {
  it("finds a command by id and by alias", () => {
    expect(findCommand("quit")?.id).toBe("quit");
    expect(findCommand("exit")?.id).toBe("quit");
    expect(findCommand("?")?.id).toBe("help");
    expect(findCommand("nope")).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(findCommand("HELP")?.id).toBe("help");
  });
});

describe("parsing a command line", () => {
  it("splits the name from its arguments", () => {
    expect(parseCommandLine("/login codex")).toEqual({ name: "login", args: ["codex"] });
    expect(parseCommandLine("/chain claude,codex")).toEqual({
      name: "chain",
      args: ["claude,codex"],
    });
    expect(parseCommandLine("/help")).toEqual({ name: "help", args: [] });
  });

  it("survives extra whitespace and a missing slash", () => {
    expect(parseCommandLine("  /model   codex   opus  ")).toEqual({
      name: "model",
      args: ["codex", "opus"],
    });
    expect(parseCommandLine("status")).toEqual({ name: "status", args: [] });
    expect(parseCommandLine("/")).toEqual({ name: "", args: [] });
  });
});

describe("filtering for the palette", () => {
  it("shows everything for a bare slash", () => {
    expect(filterCommands("/")).toHaveLength(COMMANDS.length);
  });

  it("ranks prefix matches first", () => {
    const ids = filterCommands("/lo").map((command) => command.id);
    expect(ids.slice(0, 2).sort()).toEqual(["login", "logout"]);
  });

  it("falls back to fuzzy matching", () => {
    // "cnt" is not a prefix of anything, but it is a subsequence of "continue".
    expect(filterCommands("/cnt").map((command) => command.id)).toContain("continue");
  });

  it("matches aliases too", () => {
    expect(filterCommands("/exi").map((command) => command.id)).toContain("quit");
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(filterCommands("/zzzz")).toEqual([]);
  });

  it("ignores arguments when filtering", () => {
    expect(filterCommands("/login codex")[0]?.id).toBe("login");
  });
});
