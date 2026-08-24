import { buildProgram } from "./cli/program.js";

async function main(): Promise<void> {
  await buildProgram().parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`baton: ${detail}\n`);
  process.exitCode = 1;
});
