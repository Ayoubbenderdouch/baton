/**
 * A fake provider CLI for tests: prints a fixture file line by line, optionally with
 * CRLF endings, a delay, some stderr noise, and a chosen exit code. Lets the whole
 * spawn -> parse -> event pipeline be tested without any real provider (docs/TESTING.md).
 *
 * usage: node emit.mjs <fixture> [--crlf] [--exit N] [--stderr TEXT] [--hang]
 */
import { readFileSync } from "node:fs";
import { argv, exit, stderr, stdout } from "node:process";

const [, , file, ...flags] = argv;
const crlf = flags.includes("--crlf");
const hang = flags.includes("--hang");
const exitIndex = flags.indexOf("--exit");
const exitCode = exitIndex === -1 ? 0 : Number(flags[exitIndex + 1]);
const stderrIndex = flags.indexOf("--stderr");
const stderrText = stderrIndex === -1 ? undefined : flags[stderrIndex + 1];

if (stderrText) stderr.write(`${stderrText}\n`);

if (file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim() !== "");
  for (const line of lines) stdout.write(line + (crlf ? "\r\n" : "\n"));
}

if (hang) {
  setInterval(() => stderr.write("still here\n"), 500);
} else {
  exit(exitCode);
}
