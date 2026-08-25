import type { StatusReport } from "../core/status.js";
import { formatTokens } from "../core/status.js";
import type { DetectResult } from "../core/types.js";
import { glyphs } from "./glyphs.js";
import { messages } from "./messages.js";
import { table as buildTable } from "./format.js";
import { badge, theme } from "./theme.js";


function installedCell(result: DetectResult): string {
  if (!result.installed) return `${theme.dim(glyphs().dotBlocked)} ${theme.dim("not installed")}`;
  return `${theme.success(glyphs().dotReady)} ${result.version ?? "unknown version"}`;
}

function authCell(result: DetectResult): string {
  switch (result.auth) {
    case "ok":
      return theme.success("signed in");
    case "signed_out":
      return theme.error("signed out");
    case "unknown":
      return theme.warn("unclear");
    default:
      return theme.dim("not probed");
  }
}

function verdictCell(result: DetectResult): string {
  switch (result.verdict) {
    case "ready":
      return theme.success("ready");
    case "not_installed":
      return theme.dim("install it");
    case "auth":
      return theme.error("sign in");
    default:
      return theme.warn("error");
  }
}

function remedyLines(results: DetectResult[]): string[] {
  const lines: string[] = [];
  for (const result of results) {
    if (result.verdict === "not_installed" && result.remedy) {
      lines.push(`${theme.dim(glyphs().fail)} ${messages.remedyInstall(result.id, result.remedy)}`);
    } else if (result.verdict === "auth" && result.remedy) {
      lines.push(`${theme.error(glyphs().fail)} ${messages.remedySignIn(result.id, result.remedy)}`);
    } else if (result.verdict === "error" && result.detail) {
      lines.push(`${theme.warn(glyphs().fail)} ${messages.remedyError(result.id, result.detail)}`);
    } else if (result.verdict === "ready" && result.detail !== undefined) {
      // A working agent that still has something to say (a blocked probe, for example).
      lines.push(`${theme.dim("·")} ${theme.dim(messages.remedyError(result.id, result.detail))}`);
    }
  }
  return lines;
}

export function renderDoctor(results: DetectResult[], options: { probed: boolean }): string {
  const table = buildTable(
    ["AGENT", "INSTALLED", "AUTH", "VERDICT"],
    results.map((result) => [
      badge(result.id),
      installedCell(result),
      authCell(result),
      verdictCell(result),
    ]),
  );
  const ready = results.filter((result) => result.verdict === "ready").map((r) => r.id);
  const parts = [theme.violet(theme.bold(messages.doctorTitle)), "", ...table, ""];
  const remedies = remedyLines(results);
  if (remedies.length > 0) parts.push(...remedies, "");
  parts.push(messages.doctorSummary(ready, results.length));
  if (!options.probed) parts.push(theme.dim(messages.authNotProbedNote));
  return `${parts.join("\n")}\n`;
}

export function renderAgents(results: DetectResult[]): string {
  const table = buildTable(
    ["AGENT", "CLI", "VERSION", "AVAILABLE"],
    results.map((result) => [
      badge(result.id),
      result.binPath ? theme.dim(result.binPath) : theme.dim("-"),
      result.version ?? theme.dim("-"),
      result.verdict === "ready" ? theme.success("yes") : theme.dim("no"),
    ]),
  );
  return `${theme.violet(theme.bold(messages.agentsTitle))}\n\n${table.join("\n")}\n`;
}



/** `baton status` — one dashboard across every subscription (docs/USAGE-TRACKING.md). */
export function renderStatus(report: StatusReport, options: { deep: boolean }): string {
  const rows = report.agents.map((agent) => {
    const state = agent.cooling
      ? `${theme.warn(glyphs().dotCooling)} ${theme.warn("cooling")}`
      : `${theme.success(glyphs().dotReady)} ${theme.success("ready")}`;

    const today = agent.noData
      ? theme.dim(messages.statusNoData)
      : `${agent.runsToday} ${agent.runsToday === 1 ? "run" : "runs"} · ${formatTokens(
          agent.inputTokensToday,
        )} in/${formatTokens(agent.outputTokensToday)} out`;

    const lastLimit =
      agent.lastLimitTs === undefined
        ? theme.dim("—")
        : `${agent.lastLimitTs.slice(11, 16)}${
            agent.lastLimitResetHint ? ` (${agent.lastLimitResetHint})` : ""
          }`;

    const note = agent.deep
      ? theme.dim(
          `${formatTokens(agent.deep.inputTokens)} in/${formatTokens(
            agent.deep.outputTokens,
          )} out (local history)`,
        )
      : theme.dim("");

    return [badge(agent.agent), state, today, lastLimit, note];
  });

  const header = `${theme.violet(theme.bold(messages.statusTitle))}${" ".repeat(8)}${theme.dim(
    `project: ${report.project}`,
  )}`;
  const table = buildTable(["AGENT", "STATE", "TODAY (baton runs)", "LAST LIMIT", "NOTE"], rows);
  const lines = [header, "", ...table, "", theme.dim(messages.statusTokensNote)];
  if (!options.deep) lines.push(theme.dim(messages.statusDeepHint));
  return `${lines.join("\n")}\n`;
}
