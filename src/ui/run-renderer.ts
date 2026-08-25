import type { AgentEvent, AgentId } from "../core/types.js";
import {
  chipsLine,
  doneLine,
  errorBlock,
  promptEcho,
  relayBlock,
  resultLines,
  statusLine,
  toolLine,
  type ChipState,
} from "./format.js";
import { LiveLine } from "./live-line.js";
import { renderMarkdown } from "./markdown.js";
import { messages } from "./messages.js";
import { asciify, glyphs } from "./glyphs.js";
import { isTTY, paint } from "./theme.js";
import type { RelayInfo, TaskRenderer } from "./task-renderer.js";

export interface LiveStatus {
  agent: AgentId;
  startedAt: number;
  tokens: number;
  stalled: boolean;
}

export interface RendererOptions {
  quiet?: boolean;
  verbose?: boolean;
  /** No output at all for this long -> say so instead of looking frozen. */
  stallMs?: number;
  columns?: number;
  /**
   * Where finished lines go. Default: stdout. The interactive shell passes a sink that
   * appends to its frozen history, which is why both surfaces look identical.
   */
  sink?: (line: string) => void;
  /** Sink mode only: React draws the live status line, so this reports its state. */
  onStatus?: (status: LiveStatus | undefined) => void;
}

const DEFAULT_STALL_MS = 120_000;

/**
 * The terminal view for `baton run`.
 *
 * Same visual system as the interactive shell — status line, tool lines, relay block —
 * minus the input box and the alternate screen. `--quiet` and any non-TTY get the same
 * information as plain `baton:` lines: no spinner, no cursor movement, no borders.
 */
export class RunRenderer implements TaskRenderer {
  private readonly plain: boolean;
  private readonly verbose: boolean;
  private readonly stallMs: number;
  private textBuffer = "";
  private currentAgent: AgentId | undefined;
  private startedAt = Date.now();
  private tokens = 0;
  private lastEventAt = Date.now();
  private stallTimer: NodeJS.Timeout | undefined;
  private live: LiveLine | undefined;
  private stalled = false;

  constructor(private readonly options: RendererOptions = {}) {
    // A sink means someone else owns the screen (the shell), so the rich view applies
    // even when stdout itself is not a terminal.
    this.plain = options.quiet === true || (!isTTY() && options.sink === undefined);
    this.verbose = options.verbose === true;
    this.stallMs = options.stallMs ?? DEFAULT_STALL_MS;
  }

  private get columns(): number {
    return this.options.columns ?? process.stdout.columns ?? 80;
  }

  private get sinkMode(): boolean {
    return this.options.sink !== undefined;
  }

  private emit(rawLine: string): void {
    const line = asciify(rawLine);
    const sink = this.options.sink;
    if (sink !== undefined) {
      sink(line);
      return;
    }
    process.stdout.write(`${line}\n`);
  }

  private write(line: string): void {
    this.live?.clear();
    this.emit(line);
    this.live?.start();
  }

  private writeAll(lines: string[]): void {
    this.live?.clear();
    for (const line of lines) this.emit(line);
    this.live?.start();
  }

  /** In plain mode every line is prefixed and nothing moves. */
  private say(text: string): void {
    if (this.plain) this.emit(`baton: ${text}`);
    else this.write(text);
  }

  task(task: string): void {
    if (this.plain) {
      this.emit(`baton: run "${task}"`);
      return;
    }
    this.writeAll(promptEcho(task, this.columns));
  }

  routerNote(note: string): void {
    this.say(this.plain ? note : paint.dim(note));
  }

  agentStart(agent: AgentId): void {
    this.currentAgent = agent;
    this.startedAt = Date.now();
    this.lastEventAt = Date.now();
    this.stalled = false;
    if (this.plain) {
      this.emit(`baton: ${agent} started`);
    } else if (this.sinkMode) {
      this.reportStatus();
    } else {
      this.live = new LiveLine((spinner) =>
        statusLine({
          agent,
          elapsedMs: Date.now() - this.startedAt,
          columns: this.columns,
          ...(this.tokens > 0 ? { tokens: this.tokens } : {}),
          ...(this.stalled ? { verb: messages.stillWorkingVerb } : {}),
          hint: `${spinner} ${messages.interruptHint}`,
        }),
      );
      this.live.start();
    }
    this.stallTimer = setInterval(() => this.checkStall(), 15_000);
    this.stallTimer.unref?.();
  }

  private reportStatus(): void {
    if (this.currentAgent === undefined) return;
    this.options.onStatus?.({
      agent: this.currentAgent,
      startedAt: this.startedAt,
      tokens: this.tokens,
      stalled: this.stalled,
    });
  }

  private checkStall(): void {
    const idleMs = Date.now() - this.lastEventAt;
    if (idleMs < this.stallMs) return;
    if (this.stalled) return;
    this.stalled = true;
    const note = messages.stillWorking(Math.round(idleMs / 60_000));
    if (this.plain) this.emit(`baton: ${note}`);
  }

  private flushText(): void {
    const rest = this.textBuffer.trim();
    this.textBuffer = "";
    if (rest === "") return;
    if (this.plain) {
      for (const line of rest.split("\n")) this.emit(`baton: ${line}`);
      return;
    }
    this.writeAll(renderMarkdown(rest, this.columns));
  }

  event(event: AgentEvent): void {
    this.lastEventAt = Date.now();
    this.stalled = false;
    switch (event.type) {
      case "text": {
        this.textBuffer += event.text;
        let newline = this.textBuffer.indexOf("\n\n");
        while (newline !== -1) {
          const block = this.textBuffer.slice(0, newline);
          this.textBuffer = this.textBuffer.slice(newline + 2);
          if (block.trim() !== "") {
            if (this.plain) {
              for (const line of block.trim().split("\n")) this.emit(`baton: ${line}`);
            } else {
              this.writeAll(renderMarkdown(block, this.columns));
            }
          }
          newline = this.textBuffer.indexOf("\n\n");
        }
        break;
      }
      case "tool": {
        this.flushText();
        const agent = this.currentAgent ?? "claude";
        if (this.plain) {
          this.emit(`baton: ${event.detail ? `${event.name}: ${event.detail}` : event.name}`);
        } else {
          this.write(
            toolLine({
              agent,
              name: event.name,
              columns: this.columns,
              ...(event.detail !== undefined ? { detail: event.detail } : {}),
            }),
          );
        }
        break;
      }
      case "usage":
        this.tokens += (event.inputTokens ?? 0) + (event.outputTokens ?? 0);
        if (this.sinkMode) this.reportStatus();
        break;
      case "limit":
      case "done":
      case "error":
        this.flushText();
        break;
      case "start":
        break;
    }
    if (this.verbose) this.say(paint.dim(`event ${JSON.stringify(event)}`));
  }

  /** Tool output, shown nested under the tool line. */
  toolResult(text: string, expanded = false): void {
    if (this.plain || text.trim() === "") return;
    this.writeAll(resultLines(text, { expanded, columns: this.columns }));
  }

  raw(source: "stdout" | "stderr", line: string): void {
    if (!this.verbose || line.trim() === "") return;
    this.say(paint.dim(`${source} ${line}`));
  }

  relay(info: RelayInfo): void {
    this.flushText();
    if (this.plain) {
      const reset = info.resetHint ? ` (${info.resetHint})` : "";
      this.emit(`baton: ${info.from} ${messages.limitReached}${reset}`);
      this.emit(`baton: passing the baton to ${info.to} (handoff written: ${info.handoffPath})`);
      return;
    }
    this.writeAll(
      relayBlock({
        from: info.from,
        to: info.to,
        handoffPath: info.handoffPath,
        ...(info.resetHint !== undefined ? { resetHint: info.resetHint } : {}),
      }),
    );
  }

  agentDone(agent: AgentId, durationMs: number, filesChanged: number): void {
    this.flushText();
    this.stop();
    if (this.plain) {
      this.emit(`baton: ${agent} done ${glyphs().sep} ${messages.turnSummary(durationMs, filesChanged)}`);
      return;
    }
    this.emit(doneLine({ agent, durationMs, filesChanged }));
  }

  note(text: string): void {
    this.say(this.plain ? text : paint.dim(`  ${text}`));
  }

  warn(text: string): void {
    this.say(this.plain ? text : `${paint.warn(glyphs().limit)} ${text}`);
  }

  fail(what: string, remedy?: string, logPath?: string): void {
    this.flushText();
    this.stop();
    if (this.plain) {
      this.emit(`baton: ${what}`);
      if (remedy !== undefined) this.emit(`baton: ${remedy}`);
      if (logPath !== undefined) this.emit(`baton: log: ${logPath}`);
      return;
    }
    for (const line of errorBlock({
      what,
      ...(remedy !== undefined ? { remedy } : {}),
      ...(logPath !== undefined ? { logPath } : {}),
    })) {
      this.emit(line);
    }
  }

  /** Agent chips, printed once under a finished run in the rich view. */
  chips(chips: ChipState[]): void {
    if (this.plain || chips.length === 0) return;
    this.emit(chipsLine(chips));
  }

  stop(): void {
    this.flushText();
    if (this.stallTimer !== undefined) clearInterval(this.stallTimer);
    this.stallTimer = undefined;
    this.live?.clear();
    this.live = undefined;
    if (this.sinkMode) this.options.onStatus?.(undefined);
  }
}
