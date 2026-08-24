import ora from "ora";
import { isTTY } from "./theme.js";

export interface Spinner {
  update(text: string): void;
  stop(): void;
}

/** A spinner on a TTY; a silent no-op everywhere else (pipes, CI, NO_COLOR terminals). */
export function startSpinner(text: string): Spinner {
  if (!isTTY()) {
    return { update: () => undefined, stop: () => undefined };
  }
  const spinner = ora({ text, stream: process.stdout }).start();
  return {
    update: (next: string) => {
      spinner.text = next;
    },
    stop: () => spinner.stop(),
  };
}
