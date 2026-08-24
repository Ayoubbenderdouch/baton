/** What to spawn: argv plus, for very long prompts, the stdin payload. */
export interface Invocation {
  args: string[];
  /** When set, the prompt goes through stdin instead of argv (Windows argv limit). */
  input?: string;
}
