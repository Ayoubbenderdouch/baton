import { readdirSync } from "node:fs";
import path from "node:path";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { detectAll } from "../../adapters/registry.js";
import { loadConfig } from "../../core/config.js";
import { executeTask } from "../../core/execute.js";
import { buildStatusReport } from "../../core/status.js";
import type { AgentId } from "../../core/types.js";
import { UsageStore } from "../../core/usage-store.js";
import { messages } from "../messages.js";
import { renderStatus } from "../render.js";
import { CollectingRenderer, type PaneLine } from "./collecting-renderer.js";
import {
  MAX_PANE_LINES,
  MENU,
  applyKey,
  moveSelection,
  summarize,
  type Screen,
  type WelcomeSummary,
} from "./model.js";

const VIOLET = "#8B5CF6";
const CYAN = "#22D3EE";
const MARKS = { ready: "●", cooling: "◌", blocked: "○" } as const;
const MARK_COLORS = { ready: "green", cooling: "yellow", blocked: "gray" } as const;
const LINE_COLORS: Record<PaneLine["kind"], string | undefined> = {
  text: undefined,
  tool: "gray",
  note: "gray",
  warn: "yellow",
  relay: CYAN,
  done: "green",
  fail: "red",
};

function Header({ summary }: { summary: WelcomeSummary | undefined }): React.ReactElement {
  return (
    <Box justifyContent="space-between">
      <Text color={VIOLET} bold>
        ▐ baton
      </Text>
      <Text>
        {summary === undefined
          ? ""
          : summary.rows.map((row) => (
              <Text key={row.id}>
                <Text dimColor>{row.id} </Text>
                <Text color={MARK_COLORS[row.mark]}>{MARKS[row.mark]} </Text>
              </Text>
            ))}
      </Text>
    </Box>
  );
}

function Welcome({
  summary,
  detecting,
  probed,
}: {
  summary: WelcomeSummary | undefined;
  detecting: boolean;
  probed: boolean;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text color={VIOLET} bold>
        Baton — {messages.tagline}
      </Text>
      <Box height={1} />
      {detecting || summary === undefined ? (
        <Text dimColor>looking for your agent CLIs…</Text>
      ) : (
        <Box flexDirection="column">
          {summary.rows.map((row) => (
            <Box key={row.id} flexDirection="column">
              <Box>
                <Text color={MARK_COLORS[row.mark]}>{MARKS[row.mark]} </Text>
                <Text color={VIOLET}>{`[${row.id}]`.padEnd(10)}</Text>
                <Text>{row.label}</Text>
              </Box>
              {row.remedy !== undefined && (
                <Text>
                  {"            "}
                  <Text dimColor>→ run: </Text>
                  <Text color={CYAN}>{row.remedy}</Text>
                </Text>
              )}
            </Box>
          ))}
          <Box height={1} />
          <Text>{summary.headline}</Text>
          {!probed && (
            <Text dimColor>
              logins are not verified yet — checking costs one tiny request per agent
            </Text>
          )}
        </Box>
      )}
      <Box height={1} />
      <Text dimColor>
        <Text color={CYAN}>[enter]</Text> continue · <Text color={CYAN}>[p]</Text> verify logins
        · <Text color={CYAN}>[r]</Text> re-check · <Text color={CYAN}>[q]</Text> quit
      </Text>
    </Box>
  );
}

function Menu({ selected, cwd }: { selected: number; cwd: string }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text dimColor>folder: {cwd}</Text>
      <Box height={1} />
      <Text color={VIOLET}>What do you want to do?</Text>
      {MENU.map((item, index) => (
        <Box key={item.key}>
          <Text color={index === selected ? CYAN : undefined}>
            {index === selected ? " ▸ " : "   "}
            {item.label.padEnd(24)}
          </Text>
          <Text dimColor>{item.hint}</Text>
        </Box>
      ))}
      <Box height={1} />
      <Text dimColor>↑↓ choose · enter confirm · q quit</Text>
    </Box>
  );
}

function Pane({ lines, task, running }: { lines: PaneLine[]; task: string; running: boolean }): React.ReactElement {
  const visible = lines.slice(-24);
  return (
    <Box flexDirection="column">
      <Text color={VIOLET}>◇ {task}</Text>
      <Box height={1} />
      {visible.map((line, index) => (
        <Text key={`${index}-${line.text.slice(0, 12)}`} color={LINE_COLORS[line.kind]}>
          {line.kind === "text" ? "│  " : "│  "}
          {line.text}
        </Text>
      ))}
      <Box height={1} />
      <Text dimColor>{running ? "working… (ctrl+c stops the agent)" : "[enter] back to the menu"}</Text>
    </Box>
  );
}

export function App({ initialCwd }: { initialCwd: string }): React.ReactElement {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>("welcome");
  const [summary, setSummary] = useState<WelcomeSummary | undefined>(undefined);
  const [detecting, setDetecting] = useState(true);
  const [probed, setProbed] = useState(false);
  const [cwd, setCwd] = useState(initialCwd);
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState("");
  // The keypress handler must never read a stale draft: someone who types fast and hits
  // enter immediately would otherwise lose their last characters.
  const draftRef = useRef("");
  const updateDraft = useCallback((next: string) => {
    draftRef.current = next;
    setDraft(next);
  }, []);
  const [task, setTask] = useState("");
  const [lines, setLines] = useState<PaneLine[]>([]);
  const [running, setRunning] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [folders, setFolders] = useState<string[]>([]);

  const detect = useCallback(
    async (probeAuth: boolean) => {
      setDetecting(true);
      const usage = await UsageStore.load();
      const { config } = await loadConfig(cwd);
      const results = await detectAll(probeAuth ? { probeAuth: true } : {});
      const coolingOf = (agent: AgentId): string | undefined => {
        const state = usage.cooldown(agent, config.cooldownMinutes, new Date());
        return state.cooling ? (state.resetHint ?? "cooling down") : undefined;
      };
      setSummary(summarize(results, coolingOf));
      setDetecting(false);
      if (probeAuth) setProbed(true);
    },
    [cwd],
  );

  useEffect(() => {
    void detect(false);
  }, [detect]);

  const runTaskNow = useCallback(
    async (text: string) => {
      setTask(text);
      setLines([]);
      setRunning(true);
      setScreen("running");
      const renderer = new CollectingRenderer((line) =>
        setLines((previous) => {
          const next = [...previous, line];
          return next.length <= MAX_PANE_LINES ? next : next.slice(next.length - MAX_PANE_LINES);
        }),
      );
      try {
        const outcome = await executeTask(text, cwd, renderer, {});
        if (outcome.kind === "blocked") {
          renderer.fail(outcome.reason, outcome.remedy);
        } else if (outcome.result.status === "exhausted") {
          renderer.fail(messages.allAgentsExhausted);
          for (const blocked of outcome.result.blocked) {
            renderer.note(messages.blockedAgent(blocked.agent, blocked.reason, blocked.until));
          }
        }
      } catch (error: unknown) {
        renderer.fail(error instanceof Error ? error.message : String(error));
      } finally {
        renderer.stop();
        setRunning(false);
        void detect(false);
      }
    },
    [cwd, detect],
  );

  const openFolders = useCallback(() => {
    let entries: string[];
    try {
      entries = readdirSync(cwd, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort();
    } catch {
      // why: an unreadable folder is a normal thing to land on — offer only "..".
      entries = [];
    }
    setFolders(["..", ...entries]);
    setSelected(0);
    setScreen("folder");
  }, [cwd]);

  const openStatus = useCallback(async () => {
    const usage = await UsageStore.load();
    const { config } = await loadConfig(cwd);
    setStatusText(
      renderStatus(
        buildStatusReport(usage, { project: cwd, now: new Date(), cooldownMinutes: config.cooldownMinutes }),
        { deep: false },
      ),
    );
    setScreen("status");
  }, [cwd]);

  useInput((input, key) => {
    if (screen === "welcome") {
      if (input === "q") exit();
      else if (input === "r") void detect(false);
      else if (input === "p") void detect(true);
      else if (key.return && summary?.canContinue === true) {
        setSelected(0);
        setScreen("menu");
      }
      return;
    }

    if (screen === "menu") {
      if (input === "q") exit();
      else if (key.upArrow) setSelected((current) => moveSelection(current, -1, MENU.length));
      else if (key.downArrow) setSelected((current) => moveSelection(current, 1, MENU.length));
      else if (key.return) {
        const item = MENU[selected];
        if (item === undefined) return;
        if (item.key === "quit") exit();
        else if (item.key === "task") {
          setDraft("");
          setScreen("task");
        } else if (item.key === "folder") openFolders();
        else if (item.key === "status") void openStatus();
      }
      return;
    }

    if (screen === "task") {
      if (key.escape) setScreen("menu");
      else if (key.return) {
        const text = draftRef.current.trim();
        if (text !== "") void runTaskNow(text);
      } else updateDraft(applyKey(draftRef.current, input, key));
      return;
    }

    if (screen === "running") {
      if (!running && key.return) setScreen("menu");
      return;
    }

    if (screen === "folder") {
      if (key.escape) setScreen("menu");
      else if (key.upArrow) setSelected((current) => moveSelection(current, -1, folders.length));
      else if (key.downArrow) setSelected((current) => moveSelection(current, 1, folders.length));
      else if (key.return) {
        const choice = folders[selected];
        if (choice === undefined) return;
        setCwd(path.resolve(cwd, choice));
        setSelected(0);
        setScreen("menu");
      }
      return;
    }

    if (screen === "status" && (key.return || key.escape)) setScreen("menu");
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {screen !== "welcome" && <Header summary={summary} />}
      {screen === "welcome" && <Welcome summary={summary} detecting={detecting} probed={probed} />}
      {screen === "menu" && <Menu selected={selected} cwd={cwd} />}
      {screen === "task" && (
        <Box flexDirection="column">
          <Box height={1} />
          <Text color={VIOLET}>What should the agent do?</Text>
          <Text>
            <Text color={CYAN}>❯ </Text>
            {draft}
            <Text dimColor>▏</Text>
          </Text>
          <Box height={1} />
          <Text dimColor>enter runs it · esc goes back</Text>
        </Box>
      )}
      {screen === "running" && <Pane lines={lines} task={task} running={running} />}
      {screen === "folder" && (
        <Box flexDirection="column">
          <Box height={1} />
          <Text color={VIOLET}>Where should the agents work?</Text>
          <Text dimColor>{cwd}</Text>
          <Box height={1} />
          {folders.slice(0, 15).map((name, index) => (
            <Text key={name} color={index === selected ? CYAN : undefined}>
              {index === selected ? " ▸ " : "   "}
              {name}
            </Text>
          ))}
          <Box height={1} />
          <Text dimColor>↑↓ choose · enter opens · esc goes back</Text>
        </Box>
      )}
      {screen === "status" && (
        <Box flexDirection="column">
          <Box height={1} />
          <Text>{statusText}</Text>
          <Text dimColor>[enter] back</Text>
        </Box>
      )}
    </Box>
  );
}
