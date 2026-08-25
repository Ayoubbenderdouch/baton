import type { AgentEvent, AgentId } from "../../core/types.js";
import { messages } from "../messages.js";
import type { RelayInfo, TaskRenderer } from "../task-renderer.js";

export type PaneLine = { kind: "text" | "tool" | "note" | "warn" | "relay" | "done" | "fail"; text: string };

/**
 * The same TaskRenderer the terminal uses, except it hands lines to the shell instead of
 * writing them to stdout. Line buffering for chunked provider text lives here too, so
 * both views break sentences the same way.
 */
export class CollectingRenderer implements TaskRenderer {
  private buffer = "";

  constructor(private readonly emit: (line: PaneLine) => void) {}

  private flush(): void {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (rest !== "") this.emit({ kind: "text", text: rest });
  }

  task(): void {
    // The shell already shows the task above the pane.
  }

  routerNote(note: string): void {
    this.emit({ kind: "note", text: note });
  }

  agentStart(agent: AgentId): void {
    this.emit({ kind: "note", text: `${agent} started` });
  }

  event(event: AgentEvent): void {
    switch (event.type) {
      case "text": {
        this.buffer += event.text;
        let newline = this.buffer.indexOf("\n");
        while (newline !== -1) {
          const line = this.buffer.slice(0, newline).trim();
          this.buffer = this.buffer.slice(newline + 1);
          if (line !== "") this.emit({ kind: "text", text: line });
          newline = this.buffer.indexOf("\n");
        }
        break;
      }
      case "tool":
        this.flush();
        this.emit({
          kind: "tool",
          text: event.detail ? `${event.name}: ${event.detail}` : event.name,
        });
        break;
      case "limit":
      case "error":
      case "done":
        this.flush();
        break;
      case "usage":
      case "start":
        break;
    }
  }

  raw(): void {
    // --verbose is a terminal-only affordance; the pane stays readable.
  }

  relay(info: RelayInfo): void {
    this.flush();
    const reset = info.resetHint ? ` (${info.resetHint})` : "";
    this.emit({ kind: "relay", text: `⚡ ${info.from} hit its usage limit${reset}` });
    this.emit({ kind: "relay", text: `🏃 passing the baton → ${info.to}` });
  }

  agentDone(agent: AgentId, durationMs: number, filesChanged: number): void {
    this.flush();
    this.emit({ kind: "done", text: `${agent} — ${messages.turnSummary(durationMs, filesChanged)}` });
  }

  note(text: string): void {
    this.emit({ kind: "note", text });
  }

  warn(text: string): void {
    this.emit({ kind: "warn", text });
  }

  fail(what: string, remedy?: string): void {
    this.flush();
    this.emit({ kind: "fail", text: what });
    if (remedy !== undefined) this.emit({ kind: "note", text: remedy });
  }

  stop(): void {
    this.flush();
  }
}
