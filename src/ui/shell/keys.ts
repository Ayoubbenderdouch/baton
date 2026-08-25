import { messages } from "../messages.js";

export type KeyAction =
  | { kind: "submit" }
  | { kind: "interrupt" }
  | { kind: "quit" }
  | { kind: "confirm-quit" }
  | { kind: "cycle-agent" }
  | { kind: "toggle-results" }
  | { kind: "status" }
  | { kind: "doctor" }
  | { kind: "edit"; text: string }
  | { kind: "none" };

export interface KeyState {
  running: boolean;
  /** When the last ctrl+c happened, for the double-press guard. */
  lastQuitPressAt?: number;
  now: number;
}

export const DOUBLE_PRESS_MS = 2000;

/**
 * Every keybinding in one pure function.
 *
 * Pure because the bindings are the part users build muscle memory on: they are worth
 * testing directly, and a renderless component can then just call this.
 */
export function resolveKey(
  input: string,
  key: { escape?: boolean; return?: boolean; tab?: boolean; ctrl?: boolean; backspace?: boolean; delete?: boolean },
  state: KeyState,
  buffer: string,
): KeyAction {
  if (key.ctrl === true && input === "c") {
    const previous = state.lastQuitPressAt;
    const isDouble = previous !== undefined && state.now - previous <= DOUBLE_PRESS_MS;
    return isDouble ? { kind: "quit" } : { kind: "confirm-quit" };
  }
  if (key.ctrl === true && input === "s") return { kind: "status" };
  if (key.ctrl === true && input === "d") return { kind: "doctor" };
  if (key.ctrl === true && input === "r") return { kind: "toggle-results" };

  if (key.escape === true) return state.running ? { kind: "interrupt" } : { kind: "quit" };
  if (key.tab === true) return { kind: "cycle-agent" };
  if (key.return === true) return state.running ? { kind: "none" } : { kind: "submit" };

  if (state.running) return { kind: "none" };
  if (key.backspace === true || key.delete === true) {
    return { kind: "edit", text: buffer.slice(0, -1) };
  }
  // eslint-disable-next-line no-control-regex -- printable input only
  if (input === "" || /[\x00-\x1f]/.test(input)) return { kind: "none" };
  return { kind: "edit", text: buffer + input };
}

export const quitHint = messages.confirmQuit;
