import { glyphs } from "./glyphs.js";
import { isTTY } from "./theme.js";
import { ASCII_SPINNER_FRAMES, SPINNER_FRAMES, subscribeToFrames } from "./animation.js";

/**
 * A single self-updating line for the non-interactive renderer: the same status line the
 * shell shows, drawn with a carriage return instead of a React tree.
 *
 * On anything that is not a TTY it does nothing at all — no cursor movement, no escape
 * codes (docs/CROSS-PLATFORM.md).
 */
export class LiveLine {
  private unsubscribe: (() => void) | undefined;
  private text = "";
  private painted = false;

  constructor(private readonly render: (spinner: string) => string) {}

  start(): void {
    if (!isTTY() || this.unsubscribe !== undefined) return;
    const frames = glyphs().border === "classic" ? ASCII_SPINNER_FRAMES : SPINNER_FRAMES;
    this.unsubscribe = subscribeToFrames((frame) => {
      this.draw(this.render(frames[frame % frames.length] ?? ""));
    });
  }

  private draw(next: string): void {
    if (!isTTY()) return;
    if (next === this.text && this.painted) return;
    this.text = next;
    this.painted = true;
    process.stdout.write(`\r\x1b[2K${next}`);
  }

  /** Erase the live line so a permanent line can take its place. */
  clear(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (!isTTY() || !this.painted) return;
    process.stdout.write("\r\x1b[2K");
    this.painted = false;
    this.text = "";
  }
}
