import { Command } from "commander";
import { createRequire } from "node:module";
import { agentsCommand, doctorCommand } from "./commands/doctor.js";
import { configCommand } from "./commands/config.js";
import { handoffCommand } from "./commands/handoff.js";
import { initCommand } from "./commands/init.js";
import { runCommand, type RunCommandOptions } from "./commands/run.js";
import { messages } from "../ui/messages.js";
import { theme } from "../ui/theme.js";

const require = createRequire(import.meta.url);

/**
 * The bundle lives at dist/index.js, the sources at src/cli/program.ts — package.json
 * is one level up from the bundle and two from the source. Try both, never throw.
 */
function readVersion(): string {
  for (const candidate of ["../package.json", "../../package.json"]) {
    try {
      const pkg = require(candidate) as { name?: string; version?: string };
      if (pkg.name === "baton-ai" && pkg.version) return pkg.version;
    } catch {
      // why: a missing candidate path is expected — keep looking.
    }
  }
  return "0.0.0";
}

export const VERSION = readVersion();

function todo(command: string): void {
  process.stdout.write(`${messages.notImplemented(command)}\n`);
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("baton")
    .description(`Baton — ${messages.tagline}`)
    .version(VERSION, "-v, --version", "print the baton version")
    .showHelpAfterError("(run `baton --help` for usage)")
    .addHelpText("after", `\n${theme.dim(messages.disclaimer)}\n`);

  program
    .command("run", { isDefault: true })
    .argument("[task...]", "the task to hand to an agent")
    .description('run a task with the best-suited agent (alias: baton "task")')
    .option("-a, --agent <id>", "force a specific agent (claude|codex|gemini)")
    .option(
      "-r, --role <role>",
      "pick the agent by role (architect|implement|analyze|quick)",
    )
    .option("--chain <ids>", "comma-separated failover chain override")
    .option("--auto", "let the agent edit files (maps to each CLI's own auto mode)")
    .option("--unsafe", "allow the provider's bypass mode — dangerous, opt-in only")
    .option("--relay-on-error", "also relay on non-limit errors")
    .option("--quiet", "plain output, no spinner")
    .option("--verbose", "echo raw provider events")
    .action(async (taskWords: string[], options: RunCommandOptions) => {
      await runCommand(taskWords, options);
    });

  program
    .command("continue")
    .description("continue the last task (native resume, or relay to the next agent)")
    .action(() => todo("continue"));

  program
    .command("status")
    .description("usage and cooldowns across all agents")
    .option("--json", "machine-readable output")
    .option("--deep", "include read-only local provider history")
    .action(() => todo("status"));

  program
    .command("doctor")
    .description("check which agent CLIs are installed and signed in")
    .option("--probe", "also verify sign-in by running one tiny prompt per agent")
    .action(async (options: { probe?: boolean }) => {
      await doctorCommand(options);
    });

  program
    .command("agents")
    .description("table of adapters, versions and availability")
    .action(async () => {
      await agentsCommand();
    });

  program
    .command("handoff")
    .description("write HANDOFF.md for the current session now")
    .action(async () => {
      await handoffCommand();
    });

  program
    .command("config")
    .description("print the effective config, or set a value")
    .argument("[action]", "get | set")
    .argument("[key]", "dot path, e.g. roles.architect")
    .argument("[value]", "new value")
    .option("--global", "write to the global config instead of the project one")
    .action(
      async (
        action: string | undefined,
        key: string | undefined,
        value: string | undefined,
        options: { global?: boolean },
      ) => {
        await configCommand(action, key, value, options);
      },
    );

  program
    .command("init")
    .description("create .baton/ with a project config")
    .action(async () => {
      await initCommand();
    });

  return program;
}
