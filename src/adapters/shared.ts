import { AsyncQueue } from "../core/async-queue.js";
import { activePatternTable, classifyFailureOutput } from "../core/limit-detector.js";
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
  /**
   * The provider's OWN auth commands, discovered from its installed help.
   *
   * Baton never handles a credential: it spawns these with inherited stdio so the user
   * completes the provider's own flow in their own terminal. `interactive: true` means
   * the CLI has no auth subcommand and must be opened as itself.
   */
  authCommands: {
    login?: string[];
    logout?: string[];
    /** Set when login means "open the tool and do it inside". */
    interactive?: boolean;
  };
  /** The flag this CLI takes a model name with — passed through, never interpreted. */
  modelFlag: string;
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
  return classifyProbe(spec, base, probeOutput, probe.ok, probe.timedOut);
}

/**
 * What a finished auth probe means. Pure, so it is tested against captured provider
 * output on every platform instead of through a shell shim that only exists on one.
 */
export function classifyProbe(
  spec: ProviderSpec,
  base: DetectResult,
  output: string,
  ok: boolean,
  timedOut: boolean,
): DetectResult {
  if (ok) return { ...base, auth: "ok" };
  if (looksLikeAuthProblem(output)) {
    return { ...base, auth: "signed_out", verdict: "auth", remedy: spec.loginCommand };
  }
  // The probe runs a real agent in the current folder, so it can be blocked by that
  // provider's own gate (an untrusted folder, a missing git repo) rather than by a
  // login problem. Say which, instead of shrugging with "unclear".
  const gate = gateRemedy(output);
  if (gate !== undefined) {
    return { ...base, auth: "unknown", detail: `cannot verify from this folder — ${gate}` };
  }
  return {
    ...base,
    auth: "unknown",
    detail: timedOut ? "auth probe timed out" : "auth probe failed (not a login error)",
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

/**
 * Two gates the providers enforce themselves, with wording captured in
 * fixtures/gemini/trust-error.txt and fixtures/codex/git-repo-required.txt.
 *
 * Baton never relaxes another tool's safety gate by default — it explains the gate and
 * points at the passthrough config, so opening it stays the user's decision.
 */
const GATE_REMEDIES: { pattern: RegExp; remedy: string }[] = [
  {
    pattern: /not running in a trusted directory|trusted_folders|GEMINI_CLI_TRUST_WORKSPACE/i,
    remedy:
      "gemini does not trust this folder -> run `gemini` here once and trust it, or: " +
      "baton config set agents.gemini.extraArgs -- --skip-trust",
  },
  {
    pattern: /not inside a trusted directory and --skip-git-repo-check/i,
    remedy:
      "codex only runs inside a git repository -> run `git init` here, or: " +
      "baton config set agents.codex.extraArgs -- --skip-git-repo-check",
  },
];

export function gateRemedy(output: string): string | undefined {
  return GATE_REMEDIES.find((entry) => entry.pattern.test(output))?.remedy;
}

export function firstLineOf(output: string): string {
  return output.trim().split(/\r?\n/)[0] ?? output.trim();
}

/** Turn a provider failure into a kind plus a first line the user can act on. */
export function explainFailure(output: string): { kind: "auth" | "crash"; raw: string } {
  const remedy = gateRemedy(output);
  if (remedy !== undefined) return { kind: "crash", raw: `${remedy}\n${firstLineOf(output)}` };
  return { kind: classifyFailure(output), raw: output.trim() };
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
/**
 * Test-only hook (docs/MILESTONES.md M5): `BATON_TEST_FORCE_LIMIT=claude,codex` makes
 * those adapters report a usage limit without spawning anything, so the relay can be
 * exercised — in tests and by hand — without burning real quota.
 */
export function forcedLimitAgents(): string[] {
  return (process.env.BATON_TEST_FORCE_LIMIT ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function forcedLimitHandle(id: AgentId): RunHandle {
  const queue = new AsyncQueue<AgentEvent>();
  queue.push({ type: "start" });
  queue.push({ type: "text", text: `(${id}: forced limit for testing, nothing was run)` });
  queue.push({
    type: "limit",
    raw: `BATON_TEST_FORCE_LIMIT=${id} — simulated usage limit`,
    resetHint: "resets in ~2h (simulated)",
  });
  queue.push({ type: "done", ok: false, resultText: "" });
  queue.close();
  return { events: queue, cancel: async () => undefined };
}

export function runProvider(config: ProviderRunConfig, request: RunRequest): RunHandle {
  if (forcedLimitAgents().includes(config.id)) return forcedLimitHandle(config.id);

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
  let sawError = false;
  let sessionRef: string | undefined;
  let lastText = "";
  let stderrTail = "";

  let lastFailureRaw: string | undefined;

  /**
   * One place decides what a failure means: limit (relay-eligible), auth, or crash.
   * Providers that report the same failure twice (codex sends a top-level `error` and a
   * `turn.failed` with the same payload) must announce a relay once, so identical
   * failures are pushed only once.
   */
  const pushFailure = (text: string): void => {
    const gate = gateRemedy(text);
    const classification = classifyFailureOutput(config.id, text, {
      table: activePatternTable(),
    });
    const raw = gate !== undefined ? `${gate}\n${firstLineOf(text)}` : classification.raw;
    if (raw === lastFailureRaw) return;
    lastFailureRaw = raw;

    if (classification.kind === "limit" && gate === undefined) {
      // A run hits at most one limit: providers often report it twice (a streamed error
      // line and again in the final envelope), and the relay must be announced once.
      if (sawLimit) return;
      sawLimit = true;
      queue.push({
        type: "limit",
        raw,
        ...(classification.resetHint !== undefined
          ? { resetHint: classification.resetHint }
          : {}),
      });
      return;
    }
    queue.push({
      type: "error",
      kind: classification.kind === "limit" ? "crash" : classification.kind,
      raw,
    });
  };

  const forward = (events: AgentEvent[]): void => {
    for (const event of events) {
      if (event.type === "start" && event.sessionRef !== undefined) sessionRef = event.sessionRef;
      if (event.type === "text") lastText = event.text;
      if (event.type === "limit") {
        if (sawLimit) continue;
        sawLimit = true;
        lastFailureRaw = event.raw;
      }

      if (event.type === "error" && event.kind === "unknown") {
        // Parsers report a provider-signalled failure without judging it; the judging
        // happens here, in one place, so every adapter behaves identically.
        sawError = true;
        pushFailure(`${event.raw}\n${stderrTail}`);
        continue;
      }
      if (event.type === "error") sawError = true;

      if (event.type === "done") {
        sawDone = true;
        if (event.sessionRef !== undefined) sessionRef = event.sessionRef;
        // Providers that stream text separately from the final envelope leave
        // resultText empty — fill it with what the agent actually last said.
        const resultText = event.resultText !== "" ? event.resultText : lastText;
        // A failed envelope with no error line of its own: the provider's own words are
        // the only explanation the user will get, so classify and surface them.
        if (!event.ok && !sawError && !sawLimit) {
          sawError = true;
          pushFailure(resultText !== "" ? resultText : stderrTail);
        }
        // The provider's own envelope decides success: gemini can emit a transient
        // error line and still finish with status "success".
        queue.push({
          ...event,
          resultText,
          ...(event.sessionRef === undefined && sessionRef !== undefined ? { sessionRef } : {}),
        });
        continue;
      }

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
    } else if (!sawError) {
      pushFailure(stderrTail.trim() !== "" ? stderrTail : combined);
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
