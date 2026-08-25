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
import {
  agentCompletions,
  filterCommands,
  findCommand,
  parseCommandLine,
  type CommandContext,
} from "../commands.js";
import { resolveKey } from "./keys.js";
import { Palette } from "./palette.js";
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

export interface AppProps {
  initialCwd: string;
  version: string;
  /** Hands the terminal to a provider's own auth flow and takes it back (Phase 4). */
  suspend?: (bin: string, args: string[], note?: string) => Promise<number>;
}

export function App({ initialCwd, version, suspend }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const columns = useColumns();
  const g = glyphs();

  const [history, setHistory] = useState<string[]>([]);
  /**
   * Ink's <Static> only ever appends: shrinking the array leaves it thinking those lines
   * are already on screen, so nothing new would appear. /clear therefore clears the
   * terminal for real and remounts the Static with a fresh key.
   */
  const [transcriptKey, setTranscriptKey] = useState(0);
  const [status, setStatus] = useState<LiveStatus | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [chips, setChips] = useState<ChipState[]>([]);
  const [detected, setDetected] = useState<DetectResult[]>([]);
  const [override, setOverride] = useState<AgentId | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [overlayLines, setOverlayLines] = useState<string[]>([]);
  const [quitHintShown, setQuitHintShown] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [paletteDismissed, setPaletteDismissed] = useState(false);
  const [picker, setPicker] = useState<
    { prompt: string; options: AgentId[]; disabled: AgentId[]; index: number } | undefined
  >(undefined);
  const [textPrompt, setTextPrompt] = useState<{ prompt: string; value: string } | undefined>(
    undefined,
  );
  const [role, setRole] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const pickerResolve = useRef<((agent: AgentId | undefined) => void) | undefined>(undefined);
  const textResolve = useRef<((text: string | undefined) => void) | undefined>(undefined);
  const detectedRef = useRef<DetectResult[]>([]);

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

  const refresh = useCallback(async (probeAuth = false): Promise<DetectResult[]> => {
    const usage = await UsageStore.load();
    const { config } = await loadConfig(initialCwd);
    const results = await detectAll(probeAuth ? { probeAuth: true } : {});
    setDetected(results);
    detectedRef.current = results;
    setChips(
      agentChips(results, (agent) => {
        const state = usage.cooldown(agent, config.cooldownMinutes, new Date());
        return state.cooling ? (state.resetHint ?? "cooling") : undefined;
      }),
    );
    return results;
  }, [initialCwd]);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const push1 = useCallback((line: string) => push([line]), [push]);

  const run = useCallback(
    async (
      task: string,
      start?: { agent?: AgentId; resumeRef?: string; relay?: boolean },
    ) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const renderer = new RunRenderer({
        columns,
        sink: (line) => push([line]),
        onStatus: (next) => setStatus(next),
      });
      renderer.task(task);
      try {
        const chosen = start?.agent ?? override;
        const outcome = await executeTask(task, initialCwd, renderer, {
          signal: controller.signal,
          ...(chosen !== undefined ? { agent: chosen } : {}),
          ...(role !== undefined ? { role } : {}),
          ...(start?.resumeRef !== undefined || start?.relay === true
            ? {
                start: {
                  ...(start.resumeRef !== undefined ? { sessionRef: start.resumeRef } : {}),
                  ...(start.relay === true ? { relay: true } : {}),
                },
              }
            : {}),
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
    [columns, initialCwd, override, role, push, refresh],
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

  /** The inline "pick a provider" step, as a promise the handler can await. */
  const pickAgent = useCallback(
    (options: { prompt: string; disabled?: AgentId[] }): Promise<AgentId | undefined> => {
      const disabled = options.disabled ?? [];
      const first = AGENT_IDS.findIndex((agent) => !disabled.includes(agent));
      setPicker({
        prompt: options.prompt,
        options: [...AGENT_IDS],
        disabled,
        index: first === -1 ? 0 : first,
      });
      return new Promise((resolve) => {
        pickerResolve.current = resolve;
      });
    },
    [],
  );

  const askText = useCallback((prompt: string): Promise<string | undefined> => {
    setTextPrompt({ prompt, value: "" });
    return new Promise((resolve) => {
      textResolve.current = resolve;
    });
  }, []);

  const commandContext = useCallback(
    (): CommandContext => ({
      cwd: initialCwd,
      print: push,
      refresh,
      detected: () => detectedRef.current,
      setOverride,
      setRole,
      clearTranscript: () => {
        stdout.write("\x1b[2J\x1b[H");
        setHistory([]);
        setTranscriptKey((current) => current + 1);
      },
      quit: () => exit(),
      pickAgent,
      askText,
      suspend: async (bin, args, note) => {
        if (suspend === undefined) return 1;
        setBusy(true);
        try {
          return await suspend(bin, args, note);
        } finally {
          setBusy(false);
        }
      },
      runTask: async (task, start) => run(task, start),
    }),
    [askText, exit, initialCwd, pickAgent, push, refresh, run, suspend],
  );

  const execute = useCallback(
    async (input: string) => {
      const { name, args } = parseCommandLine(input);
      const command = findCommand(name);
      push1(paint.dim(`${glyphs().caret} ${input}`));
      if (command === undefined) {
        push1(paint.warn(messages.unknownCommand(name)));
        return;
      }
      setBusy(true);
      try {
        await command.handler(args, commandContext());
      } catch (error: unknown) {
        push1(paint.error(error instanceof Error ? error.message : String(error)));
      } finally {
        setBusy(false);
      }
    },
    [commandContext, push1],
  );

  const cycleAgent = useCallback(() => {
    setOverride((current) => {
      if (current === undefined) return AGENT_IDS[0];
      const index = AGENT_IDS.indexOf(current);
      return index >= AGENT_IDS.length - 1 ? undefined : AGENT_IDS[index + 1];
    });
  }, []);

  const paletteOpen = !running && !paletteDismissed && draft.startsWith("/");
  const filtered = paletteOpen ? filterCommands(draft) : [];

  useInput((input, key) => {
    // A handler that is awaiting an answer is "busy" — but the answer arrives through
    // exactly these keys, so the picker and the text question must stay reachable.
    if (busy && picker === undefined && textPrompt === undefined) return;

    // 1. the inline agent picker owns the keyboard while it is up
    if (picker !== undefined) {
      if (key.escape) {
        setPicker(undefined);
        pickerResolve.current?.(undefined);
        pickerResolve.current = undefined;
        return;
      }
      if (key.return) {
        const chosen = picker.options[picker.index];
        setPicker(undefined);
        pickerResolve.current?.(chosen !== undefined && !picker.disabled.includes(chosen) ? chosen : undefined);
        pickerResolve.current = undefined;
        return;
      }
      if (key.leftArrow || key.upArrow || key.rightArrow || key.downArrow) {
        const step = key.leftArrow || key.upArrow ? -1 : 1;
        setPicker((current) => {
          if (current === undefined) return current;
          // Skip over providers this command cannot act on.
          let next = current.index;
          for (let tries = 0; tries < current.options.length; tries += 1) {
            next = (next + step + current.options.length) % current.options.length;
            const candidate = current.options[next];
            if (candidate !== undefined && !current.disabled.includes(candidate)) break;
          }
          return { ...current, index: next };
        });
      }
      return;
    }

    // 2. an inline text question (e.g. a model name)
    if (textPrompt !== undefined) {
      if (key.escape) {
        setTextPrompt(undefined);
        textResolve.current?.(undefined);
        textResolve.current = undefined;
        return;
      }
      if (key.return) {
        const value = textPrompt.value;
        setTextPrompt(undefined);
        textResolve.current?.(value);
        textResolve.current = undefined;
        return;
      }
      setTextPrompt((current) => {
        if (current === undefined) return current;
        if (key.backspace || key.delete) return { ...current, value: current.value.slice(0, -1) };
        // eslint-disable-next-line no-control-regex -- printable input only
        if (input === "" || /[\x00-\x1f]/.test(input)) return current;
        return { ...current, value: current.value + input };
      });
      return;
    }

    // 3. the command palette
    if (paletteOpen) {
      if (key.upArrow || key.downArrow) {
        const step = key.upArrow ? -1 : 1;
        setPaletteIndex((current) => {
          if (filtered.length === 0) return 0;
          return (current + step + filtered.length) % filtered.length;
        });
        return;
      }
      if (key.tab) {
        const typed = draftRef.current;
        const { name, args } = parseCommandLine(typed);
        const known = findCommand(name);

        // Second level: once the command is named, tab completes its agent argument.
        if (known !== undefined && (typed.endsWith(" ") || args.length > 0)) {
          const partial = (args[0] ?? "").toLowerCase();
          const match = agentCompletions(known).find((agent) => agent.startsWith(partial));
          if (match !== undefined) {
            const completed = `/${known.id} ${match}`;
            draftRef.current = completed;
            setDraft(completed);
            return;
          }
        }

        const chosen = filtered[paletteIndex];
        if (chosen !== undefined) {
          const completed = `/${chosen.id} `;
          draftRef.current = completed;
          setDraft(completed);
          setPaletteIndex(0);
        }
        return;
      }
      if (key.return) {
        const typed = draftRef.current.trim();
        const { name, args } = parseCommandLine(typed);
        // Enter on a highlighted row runs that row unless a name was typed in full.
        const chosen = findCommand(name) ?? (args.length === 0 ? filtered[paletteIndex] : undefined);
        if (chosen === undefined) {
          push1(paint.warn(messages.unknownCommand(name)));
          return;
        }
        const line = findCommand(name) !== undefined ? typed : `/${chosen.id}`;
        draftRef.current = "";
        setDraft("");
        setPaletteIndex(0);
        void execute(line);
        return;
      }
      if (key.escape) {
        setPaletteDismissed(true);
        return;
      }
    }

    const action = resolveKey(
      input,
      key,
      { running, now: Date.now(), ...(quitPressRef.current !== undefined ? { lastQuitPressAt: quitPressRef.current } : {}) },
      draftRef.current,
    );

    if (action.kind !== "confirm-quit" && quitHintShown) setQuitHintShown(false);

    switch (action.kind) {
      case "quit":
        // esc with text in the box clears it first; a second esc leaves.
        if (!running && draftRef.current !== "") {
          draftRef.current = "";
          setDraft("");
          setPaletteDismissed(false);
          return;
        }
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
        setPaletteDismissed(false);
        setPaletteIndex(0);
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
      <Static key={transcriptKey} items={history}>
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
          {paletteOpen ? (
            <Box marginY={1} flexDirection="column">
              <Palette
                value={draft}
                commands={filtered}
                selected={paletteIndex}
                columns={columns}
              />
            </Box>
          ) : (
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
          )}
          {picker !== undefined && (
            <Line>
              {`${paint.dim(picker.prompt)}  ` +
                picker.options
                  .map((agent, index) => {
                    const label =
                      index === picker.index
                        ? `${paint.primary(g.caret)} ${paint.bold(paint.agent(agent, agent))}`
                        : `  ${picker.disabled.includes(agent) ? paint.dim(agent) : paint.agent(agent, agent)}`;
                    return label;
                  })
                  .join(" ") +
                `  ${paint.dim(messages.pickerHint)}`}
            </Line>
          )}
          {textPrompt !== undefined && (
            <Line>
              {`${paint.dim(textPrompt.prompt)} ${paint.accent(g.caret)} ${textPrompt.value}`}
            </Line>
          )}
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
