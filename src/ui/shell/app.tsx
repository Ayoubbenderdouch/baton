import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
import { detectAll } from "../../adapters/registry.js";
import { loadConfig } from "../../core/config.js";
import { executeTask } from "../../core/execute.js";
import { buildStatusReport, formatTokens } from "../../core/status.js";
import { AGENT_IDS, type AgentId, type DetectResult } from "../../core/types.js";
import { UsageStore } from "../../core/usage-store.js";
import { ASCII_SPINNER_FRAMES, SPINNER_FRAMES } from "../animation.js";
import {
  chipsLine,
  doneLine,
  errorBlock,
  headerLine,
  hintLine,
  statusLine,
  table,
  type ChipState,
} from "../format.js";
import { asciify, glyphs } from "../glyphs.js";
import { messages } from "../messages.js";
import { RunRenderer, type LiveStatus } from "../run-renderer.js";
import { palette, paint } from "../theme.js";
import { resolveKey } from "./keys.js";
import { useColumns, useFrame } from "./use-frame.js";

type Overlay = "none" | "status" | "doctor";

/** Every line in the shell goes through here, so the ASCII profile applies everywhere. */
function Line({ children }: { children: string }): React.ReactElement {
  return <Text>{asciify(children)}</Text>;
}

const MAX_HISTORY = 500;

function agentChips(results: DetectResult[], cooling: (agent: AgentId) => string | undefined): ChipState[] {
  return results.map((result) => {
    if (!result.installed) return { agent: result.id, mark: "blocked", detail: "not installed" };
    if (result.verdict === "auth") return { agent: result.id, mark: "blocked", detail: "not signed in" };
    const hint = cooling(result.id);
    if (hint !== undefined) return { agent: result.id, mark: "cooling", detail: hint };
    return { agent: result.id, mark: "ready", detail: "ready" };
  });
}

function doctorRows(results: DetectResult[]): string[][] {
  const g = glyphs();
  return results.map((result) => [
    paint.agent(result.id, `[${result.id}]`),
    result.installed
      ? `${paint.success(g.dotReady)} ${result.version ?? "unknown"}`
      : `${paint.dim(g.dotBlocked)} ${paint.dim("not installed")}`,
    result.auth === "ok" ? paint.success("signed in") : paint.dim("not probed"),
    result.verdict === "ready" ? paint.success("ready") : paint.warn(result.verdict),
  ]);
}

export function App({ initialCwd, version }: { initialCwd: string; version: string }): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const columns = useColumns();
  const g = glyphs();

  const [history, setHistory] = useState<string[]>([]);
  const [status, setStatus] = useState<LiveStatus | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [chips, setChips] = useState<ChipState[]>([]);
  const [detected, setDetected] = useState<DetectResult[]>([]);
  const [override, setOverride] = useState<AgentId | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [overlayLines, setOverlayLines] = useState<string[]>([]);
  const [quitHintShown, setQuitHintShown] = useState(false);

  const draftRef = useRef("");
  const quitPressRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const running = status !== undefined;
  const frame = useFrame(running);

  const push = useCallback((lines: string[]) => {
    setHistory((previous) => {
      const next = [...previous, ...lines];
      return next.length <= MAX_HISTORY ? next : next.slice(next.length - MAX_HISTORY);
    });
  }, []);

  const refresh = useCallback(async (probeAuth: boolean) => {
    const usage = await UsageStore.load();
    const { config } = await loadConfig(initialCwd);
    const results = await detectAll(probeAuth ? { probeAuth: true } : {});
    setDetected(results);
    setChips(
      agentChips(results, (agent) => {
        const state = usage.cooldown(agent, config.cooldownMinutes, new Date());
        return state.cooling ? (state.resetHint ?? "cooling") : undefined;
      }),
    );
  }, [initialCwd]);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const run = useCallback(
    async (task: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const renderer = new RunRenderer({
        columns,
        sink: (line) => push([line]),
        onStatus: (next) => setStatus(next),
      });
      renderer.task(task);
      try {
        const outcome = await executeTask(task, initialCwd, renderer, {
          signal: controller.signal,
          ...(override !== undefined ? { agent: override } : {}),
        });
        if (outcome.kind === "blocked") {
          renderer.fail(outcome.reason, outcome.remedy);
        } else if (outcome.result.status === "done") {
          const last = outcome.result.outcomes.at(-1);
          push([
            doneLine({
              agent: last?.agent ?? outcome.startAgent,
              durationMs: last?.durationMs ?? 0,
              filesChanged: last?.filesChanged.length ?? 0,
            }),
          ]);
        } else if (outcome.result.status === "exhausted") {
          renderer.fail(messages.allAgentsExhausted, "baton status");
        } else if (outcome.result.status === "cancel") {
          push(errorBlock({ what: messages.cancelled }));
        } else {
          const last = outcome.result.outcomes.at(-1);
          renderer.fail(
            messages.agentFailed(last?.agent ?? outcome.startAgent, last?.error?.kind ?? "unknown"),
            last?.error?.raw?.split("\n")[0],
          );
        }
      } catch (error: unknown) {
        renderer.fail(error instanceof Error ? error.message : String(error));
      } finally {
        renderer.stop();
        setStatus(undefined);
        abortRef.current = undefined;
        void refresh(false);
      }
    },
    [columns, initialCwd, override, push, refresh],
  );

  const openStatus = useCallback(async () => {
    const usage = await UsageStore.load();
    const { config } = await loadConfig(initialCwd);
    const report = buildStatusReport(usage, {
      project: initialCwd,
      now: new Date(),
      cooldownMinutes: config.cooldownMinutes,
    });
    const rows = report.agents.map((agent) => [
      paint.agent(agent.agent, `[${agent.agent}]`),
      agent.cooling ? `${paint.warn(g.dotCooling)} ${paint.warn("cooling")}` : `${paint.success(g.dotReady)} ${paint.success("ready")}`,
      agent.noData
        ? paint.dim(messages.statusNoData)
        : `${agent.runsToday} · ${formatTokens(agent.inputTokensToday)} in/${formatTokens(agent.outputTokensToday)} out`,
      agent.lastLimitResetHint ?? paint.dim("—"),
    ]);
    setOverlayLines([
      ...table(["AGENT", "STATE", "TODAY", "LAST LIMIT"], rows),
      "",
      paint.dim(messages.statusTokensNote),
    ]);
    setOverlay("status");
  }, [g, initialCwd]);

  const openDoctor = useCallback(() => {
    const ready = detected.filter((result) => result.verdict === "ready").map((r) => r.id);
    setOverlayLines([
      ...table(["AGENT", "INSTALLED", "AUTH", "VERDICT"], doctorRows(detected)),
      "",
      messages.doctorSummary(ready, detected.length),
      ...detected
        .filter((result) => result.remedy !== undefined && result.verdict !== "ready")
        .map((result) => paint.accent(`${g.arrow} ${result.remedy ?? ""}`)),
    ]);
    setOverlay("doctor");
  }, [detected]);

  const cycleAgent = useCallback(() => {
    setOverride((current) => {
      if (current === undefined) return AGENT_IDS[0];
      const index = AGENT_IDS.indexOf(current);
      return index >= AGENT_IDS.length - 1 ? undefined : AGENT_IDS[index + 1];
    });
  }, []);

  useInput((input, key) => {
    const action = resolveKey(
      input,
      key,
      { running, now: Date.now(), ...(quitPressRef.current !== undefined ? { lastQuitPressAt: quitPressRef.current } : {}) },
      draftRef.current,
    );

    if (action.kind !== "confirm-quit" && quitHintShown) setQuitHintShown(false);

    switch (action.kind) {
      case "quit":
        abortRef.current?.abort();
        exit();
        return;
      case "confirm-quit":
        quitPressRef.current = Date.now();
        setQuitHintShown(true);
        return;
      case "interrupt":
        abortRef.current?.abort();
        return;
      case "submit": {
        if (overlay !== "none") {
          setOverlay("none");
          return;
        }
        const text = draftRef.current.trim();
        if (text === "") return;
        draftRef.current = "";
        setDraft("");
        void run(text);
        return;
      }
      case "cycle-agent":
        cycleAgent();
        return;
      case "toggle-results":
        setExpanded((current) => !current);
        return;
      case "status":
        void openStatus();
        return;
      case "doctor":
        openDoctor();
        return;
      case "edit":
        if (overlay !== "none") setOverlay("none");
        draftRef.current = action.text;
        setDraft(action.text);
        return;
      case "none":
        return;
    }
  });

  useEffect(() => {
    return () => {
      // Leave the terminal exactly as it was found.
      stdout.write("\x1b[?25h");
    };
  }, [stdout]);

  const spinnerFrames = g.border === "classic" ? ASCII_SPINNER_FRAMES : SPINNER_FRAMES;
  const spinner = spinnerFrames[frame % spinnerFrames.length] ?? "";

  const hints = running
    ? messages.runningHints
    : overlay !== "none"
      ? messages.finishedHints
      : messages.idleHints;

  return (
    <Box flexDirection="column">
      <Static items={history}>
        {(line, index) => <Line key={`${index}`}>{line}</Line>}
      </Static>

      {overlay !== "none" ? (
        <Box flexDirection="column" marginTop={1}>
          {overlayLines.map((line, index) => (
            <Line key={`overlay-${index}`}>{line}</Line>
          ))}
          <Box marginTop={1}>
            <Line>{hintLine(hints)}</Line>
          </Box>
        </Box>
      ) : running && status !== undefined ? (
        <Box flexDirection="column" marginTop={1}>
          <Line>
            {statusLine({
              agent: status.agent,
              elapsedMs: Date.now() - status.startedAt,
              columns,
              ...(status.tokens > 0 ? { tokens: status.tokens } : {}),
              ...(status.stalled ? { verb: messages.stillWorkingVerb } : {}),
              hint: `${spinner} ${messages.interruptHint}`,
            })}
          </Line>
          {expanded && <Line>{hintLine([messages.collapseHint])}</Line>}
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Line>{headerLine({ version, cwd: initialCwd, columns })}</Line>
          <Box
            borderStyle={g.border === "classic" ? "classic" : "round"}
            borderColor={draft === "" ? palette.muted : palette.primary}
            marginY={1}
            paddingX={1}
          >
            <Line>
              {paint.accent(`${g.caret} `) +
                (draft === "" ? paint.dim(messages.placeholder(g.ellipsis)) : draft)}
            </Line>
          </Box>
          <Line>{chipsLine(chips, override)}</Line>
          <Line>
            {hintLine(hints) +
              (override !== undefined
                ? paint.dim(`  ${g.sep}  ${messages.agentOverride(override)}`)
                : "")}
          </Line>
          {quitHintShown && <Line>{paint.dim(messages.confirmQuit)}</Line>}
        </Box>
      )}
    </Box>
  );
}
