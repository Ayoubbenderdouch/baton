import { COMMANDS } from "./commands.js";

/**
 * The command table in docs/UX-SPEC.md is generated from the registry, so a command can
 * never exist in the docs without existing in the shell, or the other way round.
 * A test regenerates this and fails on any difference.
 */
export function renderCommandTable(): string {
  const rows = COMMANDS.map((command) => {
    const name = `/${command.id}${command.args !== undefined ? ` ${command.args}` : ""}`;
    const aliases =
      command.aliases === undefined ? "" : command.aliases.map((alias) => `/${alias}`).join(", ");
    return `| \`${name}\` | ${command.description} | ${aliases} |`;
  });
  return [
    "<!-- generated from src/ui/commands.ts — run `npm test` to check -->",
    "",
    "| Command | What it does | Alias |",
    "|---|---|---|",
    ...rows,
  ].join("\n");
}
