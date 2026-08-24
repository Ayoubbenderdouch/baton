import { detectAll } from "../../adapters/registry.js";
import { messages } from "../../ui/messages.js";
import { renderAgents, renderDoctor } from "../../ui/render.js";
import { startSpinner } from "../../ui/spinner.js";

export interface DoctorOptions {
  probe?: boolean;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  const spinner = startSpinner(messages.detecting);
  const results = await detectAll({ probeAuth: options.probe === true });
  spinner.stop();
  process.stdout.write(renderDoctor(results, { probed: options.probe === true }));
  // UX-SPEC: exit 0 as long as at least one agent can actually run.
  const ready = results.filter((result) => result.verdict === "ready").length;
  process.exitCode = ready >= 1 ? 0 : 1;
}

export async function agentsCommand(): Promise<void> {
  const spinner = startSpinner(messages.detecting);
  const results = await detectAll();
  spinner.stop();
  process.stdout.write(renderAgents(results));
}
