import { executeTask } from "../../core/execute.js";
import { isAgentId, type AgentId } from "../../core/types.js";
import { messages } from "../../ui/messages.js";
import { RunRenderer } from "../../ui/run-renderer.js";
import { EXIT } from "../exit-codes.js";
import { finishRun } from "./run-result.js";

export const DEFAULT_CHAIN: AgentId[] = ["claude", "codex", "gemini"];
export const DEFAULT_MAX_RELAYS = 2;

export interface RunCommandOptions {
  agent?: string;
  role?: string;
  chain?: string;
  auto?: boolean;
  unsafe?: boolean;
  relayOnError?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export function parseChain(value: string | undefined): { chain?: AgentId[]; invalid?: string } {
  if (value === undefined) return {};
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const invalid = parts.find((part) => !isAgentId(part));
  if (invalid !== undefined) return { invalid };
  return parts.length > 0 ? { chain: parts as AgentId[] } : {};
}

export async function runCommand(
  taskWords: string[],
  options: RunCommandOptions = {},
): Promise<void> {
  const task = taskWords.join(" ").trim();
  const renderer = new RunRenderer({
    ...(options.quiet !== undefined ? { quiet: options.quiet } : {}),
    ...(options.verbose !== undefined ? { verbose: options.verbose } : {}),
  });

  if (task === "") {
    renderer.fail(messages.emptyTask, 'baton run "describe the task"');
    process.exitCode = EXIT.usage;
    return;
  }
  if (options.agent !== undefined && !isAgentId(options.agent)) {
    renderer.fail(messages.unknownAgent(options.agent), "baton agents");
    process.exitCode = EXIT.usage;
    return;
  }
  const { chain, invalid } = parseChain(options.chain);
  if (invalid !== undefined) {
    renderer.fail(messages.unknownAgent(invalid), "baton agents");
    process.exitCode = EXIT.usage;
    return;
  }

  renderer.task(task);

  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  process.once("SIGINT", onSigint);

  try {
    const outcome = await executeTask(task, process.cwd(), renderer, {
      signal: controller.signal,
      ...(options.agent !== undefined ? { agent: options.agent } : {}),
      ...(options.role !== undefined ? { role: options.role } : {}),
      ...(chain !== undefined ? { chain } : {}),
      ...(options.auto !== undefined ? { auto: options.auto } : {}),
      ...(options.unsafe !== undefined ? { unsafe: options.unsafe } : {}),
      ...(options.relayOnError !== undefined ? { relayOnError: options.relayOnError } : {}),
      ...(options.verbose !== undefined ? { verbose: options.verbose } : {}),
    });

    if (outcome.kind === "blocked") {
      renderer.fail(outcome.reason, outcome.remedy);
      process.exitCode = outcome.usage ? EXIT.usage : EXIT.exhausted;
      return;
    }
    finishRun(renderer, outcome.result, outcome.startAgent);
  } finally {
    process.removeListener("SIGINT", onSigint);
    renderer.stop();
  }
}
