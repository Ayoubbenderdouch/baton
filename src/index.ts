import { buildProgram } from "./cli/program.js";
import { writeLastError } from "./core/error-log.js";
import { messages } from "./ui/messages.js";
import { theme } from "./ui/theme.js";

async function main(): Promise<void> {
  await buildProgram().parseAsync(process.argv);
}

main().catch(async (error: unknown) => {
  const logPath = await writeLastError(error, process.argv.slice(2).join(" "));
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${theme.error("✗")} baton: ${detail}\n`);
  process.stderr.write(`  ${theme.dim(messages.unexpectedError(logPath))}\n`);
  if (process.argv.includes("--verbose") && error instanceof Error) {
    process.stderr.write(`${theme.dim(error.stack ?? "")}\n`);
  }
  process.exitCode = 1;
});
