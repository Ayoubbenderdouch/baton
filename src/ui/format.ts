import path from "node:path";
import os from "node:os";
import { formatTokens } from "../core/status.js";
import { glyphs } from "./glyphs.js";
import { messages } from "./messages.js";
import { badge, paint } from "./theme.js";
import { padEnd, truncateEnd, truncateMiddle, width, wrap } from "./width.js";

/**
 * The visual system, as pure string builders.
 *
 * Both surfaces render these: the Ink shell puts them inside boxes, the non-interactive
 * renderer writes them straight to stdout. Building the colour here — rather than as
 * nested Ink props — also sidesteps the ANSI trap that bold and dim share the same reset
 * code (`\x1b[22m`), because nothing is ever nested.
 */

export const VERB_ROTATION_MS = 8000;

export function verbFor(elapsedMs: number): string {
  const verbs = messages.workingVerbs;
  const index = Math.floor(Math.max(0, elapsedMs) / VERB_ROTATION_MS) % verbs.length;
  return verbs[index] ?? verbs[0] ?? "Working";
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** `~/projects/my-app` — the home prefix is noise in a header. */
export function prettyPath(dir: string, home: string = os.homedir()): string {
  const resolved = path.resolve(dir);
  if (resolved === home) return "~";
  const prefix = home.endsWith(path.sep) ? home : home + path.sep;
  return resolved.startsWith(prefix) ? `~${path.sep}${resolved.slice(prefix.length)}` : resolved;
}

/** One line, never two: the cwd loses its middle before the header wraps. */
export function headerLine(options: { version: string; cwd: string; columns: number }): string {
  const g = glyphs();
  const left = `${paint.primary(g.bar)} ${paint.bold("baton")}  ${paint.dim(`v${options.version}`)}`;
  const leftWidth = width(`${g.bar} baton  v${options.version}`);
  const room = options.columns - leftWidth - 2;
  if (room <= 4) return left;
  const shown = truncateMiddle(prettyPath(options.cwd), room, g.ellipsis);
  const gap = options.columns - leftWidth - width(shown);
  return `${left}${" ".repeat(Math.max(1, gap))}${paint.dim(shown)}`;
}

export interface ChipState {
  agent: string;
  mark: "ready" | "cooling" | "blocked";
  detail?: string;
}

export function chipsLine(chips: ChipState[], activeAgent?: string): string {
  const g = glyphs();
  if (chips.length === 0) return paint.dim(messages.noAgentsChip);
  return chips
    .map((chip) => {
      const dot =
        chip.mark === "ready"
          ? paint.success(g.dotReady)
          : chip.mark === "cooling"
            ? paint.warn(g.dotCooling)
            : paint.error(g.dotBlocked);
      const name =
        chip.agent === activeAgent
          ? paint.agent(chip.agent, paint.bold(chip.agent))
          : chip.mark === "blocked"
            ? paint.dim(chip.agent)
            : paint.agent(chip.agent, chip.agent);
      const detail = chip.detail === undefined ? "" : ` ${paint.dim(chip.detail)}`;
      return `${name} ${dot}${detail}`;
    })
    .join("    ");
}

export function hintLine(hints: readonly string[]): string {
  return paint.dim(hints.join(` ${glyphs().sep} `));
}

/** The submitted prompt, echoed once above the run. */
export function promptEcho(task: string, columns: number): string[] {
  const g = glyphs();
  const lines = wrap(task, Math.max(10, columns - 2));
  return lines.map((line, index) =>
    index === 0 ? `${paint.dim(g.caret)} ${line}` : `  ${line}`,
  );
}

export interface StatusLineOptions {
  agent: string;
  elapsedMs: number;
  columns: number;
  tokens?: number;
  verb?: string;
  hint?: string;
}

export function statusLine(options: StatusLineOptions): string {
  const g = glyphs();
  const verb = options.verb ?? verbFor(options.elapsedMs);
  const extras: string[] = [];
  if (options.tokens !== undefined && options.tokens > 0) {
    extras.push(`${formatTokens(options.tokens)} tokens`);
  }
  // "Sprinting… 12s · 3.1k tokens" — the verb and the clock read as one phrase.
  const body = `${verb}${g.ellipsis} ${formatElapsed(options.elapsedMs)}${
    extras.length > 0 ? ` ${g.sep} ${extras.join(` ${g.sep} `)}` : ""
  }`;
  const left = `${paint.primary(g.barLight)} ${badge(options.agent)} ${body}`;
  const leftWidth = width(`${g.barLight} [${options.agent}] ${body}`);
  const hint = options.hint ?? messages.interruptHint;
  const gap = options.columns - leftWidth - width(hint) - 1;
  if (gap < 2) return left;
  return `${left}${" ".repeat(gap)}${paint.dim(hint)}`;
}

export function toolLine(options: { agent: string; name: string; detail?: string; columns: number }): string {
  const g = glyphs();
  const head = `${paint.agent(options.agent, g.bullet)} ${paint.bold(options.name)}`;
  if (options.detail === undefined || options.detail.trim() === "") return head;
  const room = options.columns - width(`${g.bullet} ${options.name} `) - 1;
  return `${head} ${truncateEnd(options.detail.replace(/\s+/g, " ").trim(), Math.max(8, room), g.ellipsis)}`;
}

export const COLLAPSED_RESULT_LINES = 3;

/** Tool output, nested and dim, three lines until someone asks for more. */
export function resultLines(text: string, options: { expanded: boolean; columns: number }): string[] {
  const g = glyphs();
  const all = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (all.length === 0) return [];
  const room = Math.max(10, options.columns - 5);
  const shown = options.expanded ? all : all.slice(0, COLLAPSED_RESULT_LINES);
  const rendered = shown.map((line, index) => {
    const marker = index === 0 ? `  ${g.nested} ` : "    ";
    return paint.dim(`${marker}${truncateEnd(line.trim(), room, g.ellipsis)}`);
  });
  const hidden = all.length - shown.length;
  if (hidden > 0) rendered.push(paint.dim(`    ${messages.expandHint(hidden)}`));
  else if (options.expanded && all.length > COLLAPSED_RESULT_LINES) {
    rendered.push(paint.dim(`    ${messages.collapseHint}`));
  }
  return rendered;
}

/** The signature moment: two loud lines, blank line above and below. */
export function relayBlock(options: {
  from: string;
  to: string;
  resetHint?: string;
  handoffPath?: string;
}): string[] {
  const g = glyphs();
  const reset = options.resetHint === undefined ? "" : ` ${g.sep} ${options.resetHint}`;
  const handoff =
    options.handoffPath === undefined
      ? ""
      : ` ${g.sep} ${messages.relayHandoffNote} ${g.sep} ${path.basename(options.handoffPath)}`;
  return [
    "",
    `${paint.warn(g.limit)} ${badge(options.from)} ${messages.limitReached}${reset}`,
    `${paint.accent(g.relay)} ${paint.accent(`passing the baton ${g.arrow}`)} ${badge(options.to)}${paint.dim(handoff)}`,
    "",
  ];
}

export function doneLine(options: {
  agent: string;
  durationMs: number;
  filesChanged: number;
  saved?: boolean;
}): string {
  const g = glyphs();
  const files =
    options.filesChanged === 1 ? "1 file changed" : `${options.filesChanged} files changed`;
  const parts = [badge(options.agent), formatElapsed(options.durationMs), files];
  if (options.saved !== false) parts.push(messages.sessionSaved);
  return `${paint.success(g.done)} ${paint.success("done")} ${g.sep} ${parts.join(` ${g.sep} `)}`;
}

/** Remedy-first, three lines at most (docs/UX-SPEC.md). */
export function errorBlock(options: { what: string; remedy?: string; logPath?: string }): string[] {
  const g = glyphs();
  const lines = [`${paint.error(g.fail)} ${options.what}`];
  if (options.remedy !== undefined) lines.push(`  ${paint.accent(`${g.arrow} ${options.remedy}`)}`);
  if (options.logPath !== undefined) lines.push(paint.dim(`  log: ${options.logPath}`));
  return lines;
}

/** Aligned table for status / doctor / agents, measured in real cells. */
export function table(headers: string[], rows: string[][], gap = 2): string[] {
  const widths = headers.map((header, column) =>
    Math.max(width(header), ...rows.map((row) => width(row[column] ?? ""))),
  );
  const spacer = " ".repeat(gap);
  const head = paint.dim(
    paint.bold(headers.map((header, index) => padEnd(header, widths[index] ?? 0)).join(spacer).trimEnd()),
  );
  return [
    head,
    ...rows.map((row) =>
      row
        .map((cell, index) => padEnd(cell, widths[index] ?? 0))
        .join(spacer)
        .trimEnd(),
    ),
  ];
}
