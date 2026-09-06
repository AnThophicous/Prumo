import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export function commandExists(name, env = process.env) {
  const pathValue = env.PATH ?? env.Path ?? "";
  if (!pathValue) return false;
  const extensions = process.platform === "win32"
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

export function directoryExists(path) {
  return existsSync(path);
}

export function detectTarget(adapter, env = process.env, home = homedir()) {
  const commandFound = adapter.commands.some(command => commandExists(command, env));
  const configFound = adapter.configDirs(home).some(directoryExists);
  return {
    id: adapter.id,
    label: adapter.label,
    installed: commandFound || configFound,
    evidence: commandFound ? "command on PATH" : configFound ? "config directory" : "not found",
    capabilities: adapter.capabilities
  };
}

export function detectAll(adapters, env = process.env, home = homedir()) {
  return adapters.map(adapter => detectTarget(adapter, env, home));
}
