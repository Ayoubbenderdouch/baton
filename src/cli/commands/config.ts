import path from "node:path";
import {
  CONFIG_KEYS,
  globalConfigPath,
  loadConfig,
  projectConfigPath,
  readRawConfig,
  setByPath,
  writeConfigFile,
} from "../../core/config.js";
import { messages } from "../../ui/messages.js";
import { theme } from "../../ui/theme.js";
import { EXIT } from "../exit-codes.js";

export interface ConfigCommandOptions {
  global?: boolean;
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

export async function configCommand(
  action: string | undefined,
  key: string | undefined,
  value: string | undefined,
  options: ConfigCommandOptions = {},
): Promise<void> {
  const cwd = process.cwd();

  if (action === undefined || action === "show") {
    const { config, origins, warnings } = await loadConfig(cwd);
    for (const warning of warnings) print(theme.warn(`! ${warning}`));
    print(theme.violet(theme.bold(messages.configTitle)));
    print("");
    for (const configKey of CONFIG_KEYS) {
      const value = (config as Record<string, unknown>)[configKey];
      const origin = theme.dim(`(${origins[configKey] ?? "default"})`);
      const inline = JSON.stringify(value);
      if (inline !== undefined && inline.length <= 72) {
        print(`${configKey}: ${inline} ${origin}`);
        continue;
      }
      // Long values (rules, roles) read better on their own indented lines.
      print(`${configKey}: ${origin}`);
      for (const line of JSON.stringify(value, null, 2).split("\n")) print(`  ${line}`);
    }
    print("");
    print(theme.dim(`global: ${globalConfigPath()}`));
    print(theme.dim(`project: ${projectConfigPath(cwd)}`));
    process.exitCode = EXIT.ok;
    return;
  }

  if (action === "get") {
    if (key === undefined) {
      print(theme.error(messages.configGetNeedsKey));
      process.exitCode = EXIT.usage;
      return;
    }
    const { config } = await loadConfig(cwd);
    let cursor: unknown = config;
    for (const part of key.split(".")) {
      if (typeof cursor !== "object" || cursor === null) {
        cursor = undefined;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[part];
    }
    if (cursor === undefined) {
      print(theme.error(messages.configUnknownKey(key)));
      process.exitCode = EXIT.usage;
      return;
    }
    print(typeof cursor === "string" ? cursor : JSON.stringify(cursor));
    process.exitCode = EXIT.ok;
    return;
  }

  if (action === "set") {
    if (key === undefined || value === undefined) {
      print(theme.error(messages.configSetNeedsKeyValue));
      process.exitCode = EXIT.usage;
      return;
    }
    const file = options.global === true ? globalConfigPath() : projectConfigPath(cwd);
    const raw = await readRawConfig(file);
    const result = setByPath(raw, key, value);
    if (!result.ok) {
      print(theme.error(`✗ ${result.error}`));
      process.exitCode = EXIT.usage;
      return;
    }
    await writeConfigFile(file, raw);
    print(
      `${theme.success("✓")} ${key} = ${JSON.stringify(result.value)} ${theme.dim(
        `(${path.relative(cwd, file) || file})`,
      )}`,
    );
    process.exitCode = EXIT.ok;
    return;
  }

  print(theme.error(messages.configUnknownAction(action)));
  process.exitCode = EXIT.usage;
}
