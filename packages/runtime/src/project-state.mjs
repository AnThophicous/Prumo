import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrumoError } from "./errors.mjs";
import { layout, projectStateKey } from "./paths.mjs";

export function projectStatePath(workspace, env = process.env, home = homedir()) {
  return join(layout(env, home).projectsStateDir, `${projectStateKey(workspace)}.json`);
}

export function writeProjectState(workspace, state, { env = process.env, home = homedir(), now = new Date() } = {}) {
  const path = projectStatePath(workspace, env, home);
  const record = { workspace, updatedAt: now.toISOString(), ...state };
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  } catch (error) {
    throw new PrumoError("PRUMO_E_STATE_WRITE", `cannot write ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { path, record };
}

export function readProjectState(workspace, env = process.env, home = homedir()) {
  const path = projectStatePath(workspace, env, home);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}
