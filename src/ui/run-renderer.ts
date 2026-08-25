import type { AgentEvent, AgentId } from "../core/types.js";
import type { RelayInfo, TaskRenderer } from "./task-renderer.js";
import { messages } from "./messages.js";
import { startSpinner, type Spinner } from "./spinner.js";
import { badge, isTTY, theme } from "./theme.js";

export interface RendererOptions {
  quiet?: boolean;
  verbose?: boolean;
  /** No output for this long -> say so instead of looking frozen. */
  stallMs?: number;
}

const BAR = "│";
const START = "◇";
const RUN = "▐";
const DONE = "◆";
const DEFAULT_STALL_MS = 120_000;

function clip(text: string, max = 100): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

/**
 * The run view (docs/UX-SPEC.md). Two paths, same information: a live TTY view with a
 * spinner, and plain `baton:` lines everywhere else (pipes, CI, --quiet).
 */
export class RunRenderer implements TaskRenderer {
  private readonly plain: boolean;
  private readonly verbose: boolean;
  private readonly stallMs: number;
  private spinner: Spinner | undefined;
  private stallTimer: NodeJS.Timeout | undefined;
  private lastEventAt = Date.now();
  private currentAgent: AgentId | undefined;
  /** Assistant text arrives in chunks that split mid-sentence — buffer to whole lines. */
  private textBuffer = "";

  constructor(options: RendererOptions = {}) {
    this.plain = options.quiet === true || !isTTY();
    this.verbose = options.verbose === true;
    this.stallMs = options.stallMs ?? DEFAULT_STALL_MS;
  }

  private write(line: string): void {
    this.spinner?.stop();
    process.stdout.write(`${line}\n`);
    if (this.spinner && this.currentAgent) this.startSpinnerFor(this.currentAgent);
  }

  private startSpinnerFor(agent: AgentId): void {
    if (this.plain) return;
    this.spinner = startSpinner(`${RUN} ${badge(agent)} ${theme.dim("working")}`);
  }

  task(task: string): void {
    this.write(this.plain ? `baton: run "${clip(task, 120)}"` : `${theme.violet(START)} baton run "${clip(task, 120)}"`);
  }

  routerNote(note: string): void {
    this.write(this.plain ? `baton: ${note}` : `${theme.dim(BAR)} ${theme.dim(note)}`);
  }

  agentStart(agent: AgentId): void {
    this.currentAgent = agent;
    this.lastEventAt = Date.now();
    if (this.plain) {
      this.write(`baton: ${agent} started`);
    } else {
      this.startSpinnerFor(agent);
    }
    this.stallTimer = setInterval(() => this.checkStall(), 15_000);
    this.stallTimer.unref?.();
  }

  private checkStall(): void {
    const idleMs = Date.now() - this.lastEventAt;
    if (idleMs < this.stallMs) return;
    const minutes = Math.round(idleMs / 60_000);
    const note = messages.stillWorking(minutes);
    if (this.plain) this.write(`baton: ${note}`);
    else this.spinner?.update(`${RUN} ${badge(this.currentAgent ?? "claude")} ${theme.dim(note)}`);
  }

  /**
   * Providers chunk their text differently: Claude sends whole messages, Gemini streams
   * fragments that break mid-sentence. Buffering to line boundaries makes both read the
   * same way, and the leftover is flushed by any other event or by the end of the turn.
   */
  private appendText(text: string): void {
    this.textBuffer += text;
    let newline = this.textBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.textBuffer.slice(0, newline).trim();
      this.textBuffer = this.textBuffer.slice(newline + 1);
      if (line !== "") this.write(this.line(line));
      newline = this.textBuffer.indexOf("\n");
    }
  }

  private flushText(): void {
    const rest = this.textBuffer.trim();
    this.textBuffer = "";
    if (rest !== "") this.write(this.line(rest));
  }

  event(event: AgentEvent): void {
    this.lastEventAt = Date.now();
    switch (event.type) {
      case "text":
        this.appendText(event.text);
        break;
      case "tool":
        this.flushText();
        this.write(
          this.line(theme.dim(event.detail ? `${event.name}: ${clip(event.detail)}` : event.name)),
        );
        break;
      case "limit":
      case "done":
      case "error":
        this.flushText();
        break;
      case "usage":
      case "start":
        break;
    }
    if (this.verbose) this.write(theme.dim(`  event ${JSON.stringify(event)}`));
  }

  raw(source: "stdout" | "stderr", line: string): void {
    if (!this.verbose || line.trim() === "") return;
    this.write(theme.dim(`  ${source} ${clip(line, 160)}`));
  }

  private line(text: string): string {
    return this.plain ? `baton: ${text}` : `${theme.dim(BAR)}  ${text}`;
  }

  /** The signature moment — loud, two lines, exactly per UX-SPEC. */
  relay(info: RelayInfo): void {
    this.flushText();
    const reset = info.resetHint ? ` (${info.resetHint})` : "";
    if (this.plain) {
      this.write(`baton: ${info.from} hit its usage limit${reset}`);
      this.write(`baton: passing the baton to ${info.to} (handoff written: ${info.handoffPath})`);
      return;
    }
    this.write(
      `${theme.warn("⚡")} ${badge(info.from)} ${theme.warn(`hit its usage limit${reset}`)}`,
    );
    this.write(
      `${theme.accent("🏃")} ${theme.accent("passing the baton →")} ${badge(info.to)}  ${theme.dim(
        `(handoff written: ${info.handoffPath})`,
      )}`,
    );
  }

  agentDone(agent: AgentId, durationMs: number, filesChanged: number): void {
    this.flushText();
    const summary = messages.turnSummary(durationMs, filesChanged);
    this.stop();
    this.write(
      this.plain
        ? `baton: ${agent} done — ${summary}`
        : `${theme.success(DONE)} ${badge(agent)} ${summary}`,
    );
  }

  note(text: string): void {
    this.write(this.plain ? `baton: ${text}` : `${theme.dim(BAR)} ${theme.dim(text)}`);
  }

  warn(text: string): void {
    this.write(this.plain ? `baton: ${text}` : `${theme.warn("!")} ${text}`);
  }

  /** Errors are remedy-first and never more than three lines (baton-ui-style). */
  fail(what: string, remedy?: string, logPath?: string): void {
    this.flushText();
    this.stop();
    this.write(this.plain ? `baton: ${what}` : `${theme.error("✗")} ${what}`);
    if (remedy) this.write(this.plain ? `baton: ${remedy}` : `  ${theme.accent(remedy)}`);
    if (logPath) this.write(theme.dim(`  ${messages.logHint(logPath)}`));
  }

  stop(): void {
    this.flushText();
    if (this.stallTimer) clearInterval(this.stallTimer);
    this.stallTimer = undefined;
    this.spinner?.stop();
    this.spinner = undefined;
  }
}
