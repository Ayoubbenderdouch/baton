import { AsyncQueue } from "../core/async-queue.js";
import { resolveBin } from "../core/resolve-bin.js";
import { parseVersion, runOnce, spawnStreaming } from "../core/spawn.js";
import { toLines } from "../core/stream.js";
import type {
  AgentEvent,
  AgentId,
  DetectOptions,
  DetectResult,
  RunHandle,
  RunRequest,
} from "../core/types.js";
import type { Invocation } from "./invocation.js";

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

/**
 * Classify a failed run when the provider gave us no structured signal.
 * Limit detection proper lives in the LimitDetector (M5); this only separates a
 * sign-in problem from a plain crash so the user gets the right remedy.
 */
export function classifyFailure(output: string): "auth" | "crash" {
  return looksLikeAuthProblem(output) ? "auth" : "crash";
}

/** Windows caps a command line at ~32k chars — long prompts go through stdin instead. */
export const MAX_PROMPT_ARG_CHARS = 8000;

/** How much stderr to keep for classification — enough to match, never unbounded. */
const STDERR_TAIL_LIMIT = 64_000;

export interface ProviderRunConfig {
  id: AgentId;
  binName: string;
  installCommand: string;
  invocation: Invocation;
  /** Pure mapping of one stdout line to events (fixture-tested per provider). */
  parseLine: (line: string) => AgentEvent[];
  /** Some CLIs (codex) put progress on stderr — optional extra mapping. */
  parseStderrLine?: (line: string) => AgentEvent[];
}

/**
 * The shared run loop: spawn the official CLI, turn its output into AgentEvents, and
 * close the stream with exactly one `done`.
 *
 * Nothing provider-specific lives here — the differences are the invocation and the
 * two pure parse functions each adapter passes in.
 */
export function runProvider(config: ProviderRunConfig, request: RunRequest): RunHandle {
  const queue = new AsyncQueue<AgentEvent>();
  const binPath = resolveBin(config.binName);

  if (binPath === undefined) {
    queue.push({
      type: "error",
      kind: "not_installed",
      raw: `${config.binName} is not on PATH — install it with: ${config.installCommand}`,
    });
    queue.push({ type: "done", ok: false, resultText: "" });
    queue.close();
    return { events: queue, cancel: async () => undefined };
  }

  const child = spawnStreaming(binPath, config.invocation.args, {
    cwd: request.cwd,
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    ...(config.invocation.input !== undefined ? { input: config.invocation.input } : {}),
  });

  let cancelled = false;
  let sawDone = false;
  let sawLimit = false;
  let sessionRef: string | undefined;
  let lastText = "";
  let stderrTail = "";

  const forward = (events: AgentEvent[]): void => {
    for (const event of events) {
      if (event.type === "done") {
        sawDone = true;
        if (event.sessionRef !== undefined) sessionRef = event.sessionRef;
      }
      if (event.type === "start" && event.sessionRef !== undefined) sessionRef = event.sessionRef;
      if (event.type === "limit") sawLimit = true;
      if (event.type === "text") lastText = event.text;
      queue.push(event);
    }
  };

  const pump = async (): Promise<void> => {
    const readStdout = (async () => {
      for await (const line of toLines(child.stdout)) {
        request.onRawLine?.("stdout", line);
        forward(config.parseLine(line));
      }
    })();
    const readStderr = (async () => {
      for await (const line of toLines(child.stderr)) {
        request.onRawLine?.("stderr", line);
        if (stderrTail.length < STDERR_TAIL_LIMIT) stderrTail += `${line}\n`;
        if (config.parseStderrLine) forward(config.parseStderrLine(line));
      }
    })();

    await Promise.allSettled([readStdout, readStderr]);
    const result = await child.done;

    if (cancelled) {
      if (!sawDone) queue.push({ type: "done", ok: false, resultText: lastText });
      queue.close();
      return;
    }

    if (sawDone) {
      queue.close();
      return;
    }

    // The CLI ended without a final envelope: say why in the provider's own words.
    const combined = `${lastText}\n${stderrTail}`;
    if (sawLimit) {
      queue.push({ type: "done", ok: false, resultText: lastText, ...(sessionRef ? { sessionRef } : {}) });
      queue.close();
      return;
    }
    if (result.timedOut) {
      queue.push({ type: "error", kind: "crash", raw: "the agent CLI hit Baton's run timeout" });
    } else {
      queue.push({ type: "error", kind: classifyFailure(combined), raw: stderrTail.trim() || combined.trim() });
    }
    queue.push({ type: "done", ok: false, resultText: lastText, ...(sessionRef ? { sessionRef } : {}) });
    queue.close();
  };

  void pump();

  return {
    events: queue,
    cancel: async () => {
      cancelled = true;
      await child.kill();
    },
  };
}
