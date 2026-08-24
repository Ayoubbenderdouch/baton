/** Stable exit codes — scripts and CI depend on these. */
export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  /** Every agent is out of quota or unavailable (docs/FAILOVER.md §3). */
  exhausted: 3,
  cancelled: 130,
} as const;
