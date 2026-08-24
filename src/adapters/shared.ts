import { resolveBin } from "../core/resolve-bin.js";
import { parseVersion, runOnce } from "../core/spawn.js";
import type { AgentId, DetectOptions, DetectResult } from "../core/types.js";

/** Everything provider-specific that detection needs, in one literal per adapter. */
export interface ProviderSpec {
  id: AgentId;
  displayName: string;
  binName: string;
  versionArgs: string[];
  /** The provider's own install command — Baton never installs anything itself. */
  installCommand: string;
  /** The provider's own login command — Baton never touches authentication. */
  loginCommand: string;
  /** A 1-token no-op run used only by the opt-in `baton doctor --probe`. */
  probeArgs: string[];
}

/**
 * Sign-in problems, as the CLIs word them. Kept deliberately narrow: a false "auth"
 * verdict sends the user to a login screen they do not need.
 */
const AUTH_PATTERNS: RegExp[] = [
  /\bnot (?:logged|signed) in\b/i,
  /\bplease (?:log|sign) ?in\b/i,
  /\brun `?(?:claude|codex|gemini)`? (?:to )?(?:log|sign) ?in\b/i,
  /\bauthentication (?:required|failed|error)\b/i,
  /\bunauthorized\b/i,
  /\b401\b/,
  /\bcredentials? (?:not found|missing|expired|invalid)\b/i,
  /\blogin (?:required|expired)\b/i,
  /\bno auth(?:entication)? (?:token|method)\b/i,
  /\bsession (?:expired|invalid)\b/i,
];

export function looksLikeAuthProblem(text: string): boolean {
  return AUTH_PATTERNS.some((pattern) => pattern.test(text));
}

const VERSION_TIMEOUT_MS = 10_000;
// why: a real agent turn (codex reasoning included) regularly needs more than a
// minute — a short probe timeout reports a false "unclear" verdict.
const PROBE_TIMEOUT_MS = 180_000;

/**
 * Detect one provider CLI: installed? which version? (opt-in) signed in?
 *
 * The auth probe is opt-in because the only honest way to test sign-in without
 * touching credentials is to actually run the agent once — which costs the user a
 * request. `baton doctor` therefore reports `not probed` unless asked.
 */
export async function detectProvider(
  spec: ProviderSpec,
  options: DetectOptions = {},
): Promise<DetectResult> {
  const binPath = resolveBin(spec.binName);
  if (binPath === undefined) {
    return {
      id: spec.id,
      installed: false,
      auth: "not_probed",
      verdict: "not_installed",
      detail: `${spec.binName} is not on PATH`,
      remedy: spec.installCommand,
    };
  }

  const versionRun = await runOnce(binPath, spec.versionArgs, {
    timeoutMs: options.timeoutMs ?? VERSION_TIMEOUT_MS,
  });
  const version = parseVersion(`${versionRun.stdout}\n${versionRun.stderr}`);

  if (!versionRun.ok && versionRun.notInstalled) {
    return {
      id: spec.id,
      installed: false,
      auth: "not_probed",
      verdict: "not_installed",
      detail: `${spec.binName} disappeared from PATH mid-check`,
      remedy: spec.installCommand,
    };
  }

  const base: DetectResult = {
    id: spec.id,
    installed: true,
    binPath,
    version,
    auth: "not_probed",
    verdict: "ready",
  };

  if (!versionRun.ok) {
    const output = `${versionRun.stdout}\n${versionRun.stderr}`;
    if (looksLikeAuthProblem(output)) {
      return { ...base, auth: "signed_out", verdict: "auth", remedy: spec.loginCommand };
    }
    return {
      ...base,
      verdict: "error",
      detail: versionRun.timedOut
        ? `${spec.binName} --version timed out`
        : (versionRun.errorMessage ?? `${spec.binName} --version failed`),
    };
  }

  if (options.probeAuth !== true) return base;

  const probe = await runOnce(binPath, spec.probeArgs, {
    timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS,
  });
  const probeOutput = `${probe.stdout}\n${probe.stderr}`;
  if (probe.ok) return { ...base, auth: "ok" };
  if (looksLikeAuthProblem(probeOutput)) {
    return { ...base, auth: "signed_out", verdict: "auth", remedy: spec.loginCommand };
  }
  return {
    ...base,
    auth: "unknown",
    detail: probe.timedOut ? "auth probe timed out" : "auth probe failed (not a login error)",
  };
}

/** Placeholder run handle used until an adapter's real streaming lands. */
export function unimplementedRun(id: AgentId): {
  events: AsyncIterable<never>;
  cancel(): Promise<void>;
} {
  return {
    events: {
      // eslint-disable-next-line require-yield -- an immediately-empty stream by design
      async *[Symbol.asyncIterator]() {
        throw new Error(`${id} adapter cannot run yet (not implemented)`);
      },
    },
    cancel: async () => undefined,
  };
}
