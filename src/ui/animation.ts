/**
 * One animation clock for the whole process.
 *
 * Every animated element subscribes to this instead of starting its own interval, so a
 * run with a spinner, an elapsed counter and a rotating verb still costs exactly one
 * timer (docs/UX-SPEC.md, performance rules).
 */
export const FRAME_MS = 100;

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
export const ASCII_SPINNER_FRAMES = ["-", "\\", "|", "/"] as const;

type Listener = (frame: number) => void;

let timer: NodeJS.Timeout | undefined;
let frame = 0;
const listeners = new Set<Listener>();

function tick(): void {
  frame += 1;
  for (const listener of listeners) listener(frame);
}

export function subscribeToFrames(listener: Listener): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    timer = setInterval(tick, FRAME_MS);
    // Never hold the process open for the sake of an animation.
    timer.unref?.();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function currentFrame(): number {
  return frame;
}

/** Tests only. */
export function resetFrames(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  frame = 0;
  listeners.clear();
}
