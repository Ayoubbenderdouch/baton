import { createInterface } from "node:readline/promises";
import path from "node:path";
import { DEFAULT_CONFIG, projectConfigPath, writeConfigFile } from "../../core/config.js";
import { AGENT_IDS, isAgentId, type AgentId } from "../../core/types.js";
import { messages } from "../../ui/messages.js";
import { isTTY, theme } from "../../ui/theme.js";
import { EXIT } from "../exit-codes.js";

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Interactive on a TTY, silent defaults everywhere else. The questions use Node's own
 * readline — a prompt library would be a dependency this project does not need.
 */
export async function initCommand(): Promise<void> {
  const cwd = process.cwd();
  const file = projectConfigPath(cwd);

  let chain: AgentId[] = DEFAULT_CONFIG.chain;
  let permissionLevel = DEFAULT_CONFIG.permissionLevel;

  if (isTTY()) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      print(theme.violet(theme.bold(messages.initTitle)));
      const chainAnswer = (
        await rl.question(`chain order [${DEFAULT_CONFIG.chain.join(",")}]: `)
      ).trim();
      if (chainAnswer !== "") {
        const parts = chainAnswer.split(",").map((part) => part.trim()).filter(Boolean);
        const invalid = parts.find((part) => !isAgentId(part));
        if (invalid !== undefined) {
          print(theme.warn(`! unknown agent "${invalid}" — keeping the default chain`));
        } else {
          chain = parts as AgentId[];
        }
      }
      const permissionAnswer = (
        await rl.question("let agents edit files by default? [y/N]: ")
      ).trim().toLowerCase();
      if (permissionAnswer === "y" || permissionAnswer === "yes") permissionLevel = "auto";
    } finally {
      rl.close();
    }
  }

  await writeConfigFile(file, { chain, permissionLevel });
  print(`${theme.success("✓")} ${messages.initWritten(path.relative(cwd, file) || file)}`);
  print(theme.dim(messages.initNext(AGENT_IDS.join(", "))));
  process.exitCode = EXIT.ok;
}
