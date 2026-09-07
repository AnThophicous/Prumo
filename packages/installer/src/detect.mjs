import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const PROBE_TIMEOUT_MS = 3000;

export function commandExists(name, env = process.env, platform = process.platform) {
  const pathValue = env.PATH ?? env.Path ?? "";
  if (!pathValue) return false;
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map(entry => entry.toLowerCase()).filter(Boolean)
    : [""];
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      if (existsSync(join(directory, name + extension))) return true;
    }
  }
  return false;
}

export function probeVersion(command, env = process.env, { probe = true } = {}) {
  if (!probe || !commandExists(command, env)) return undefined;
  try {
    const output = execFileSync(command, ["--version"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS, env, stdio: ["ignore", "pipe", "ignore"], windowsHide: true, shell: process.platform === "win32" });
    return output.trim().split(/\r?\n/)[0].slice(0, 80);
  } catch {
    return undefined;
  }
}

export function detectTarget(adapter, env = process.env, home = homedir(), { probe = false } = {}) {
  const commandFound = adapter.commands.find(command => commandExists(command, env));
  const configDir = adapter.configDirs(home).find(directory => existsSync(directory));
  const version = commandFound ? probeVersion(commandFound, env, { probe }) : undefined;
  return {
    id: adapter.id,
    label: adapter.label,
    installed: Boolean(commandFound || configDir),
    detected: { command: commandFound, configDir, version },
    evidence: commandFound ? `command ${commandFound} on PATH${version ? ` (${version})` : ""}` : configDir ? `config directory ${configDir}` : "not found",
    capabilities: adapter.capabilities
  };
}

export function detectAll(adapters, env = process.env, home = homedir(), options = {}) {
  return adapters.map(adapter => detectTarget(adapter, env, home, options));
}
