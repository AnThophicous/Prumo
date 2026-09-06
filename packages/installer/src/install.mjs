import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeAdapter } from "./adapters/claude.mjs";
import { codexAdapter } from "./adapters/codex.mjs";
import { cursorAdapter } from "./adapters/cursor.mjs";
import { grokAdapter } from "./adapters/grok.mjs";
import { copyDirectory, copyInto, ensureDirectory } from "./fsops.mjs";
import { prumoHome } from "./protocol.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");

export const ADAPTERS = [claudeAdapter, codexAdapter, cursorAdapter, grokAdapter];

export function adapterById(id) {
  return ADAPTERS.find(adapter => adapter.id === id);
}

export function runtimePaths(env = process.env, home = homedir()) {
  const root = prumoHome(env, home);
  return {
    root,
    contentDir: join(root, "content"),
    hookPath: join(root, "hooks", "prumo-hook.mjs"),
    statuslinePath: join(root, "statusline", "prumo-statusline.mjs"),
    protocolSrcDir: resolveSourceDir(),
    hookSrc: join(packageRoot, "hooks", "prumo-hook.mjs"),
    statuslineSrc: join(packageRoot, "statusline", "prumo-statusline.mjs"),
    protocolRuntimePath: join(root, "src", "protocol.mjs"),
    protocolRuntimeSrc: join(packageRoot, "src", "protocol.mjs")
  };
}

function resolveSourceDir() {
  const candidates = [join(packageRoot, "content"), join(packageRoot, "..", "..", "content")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export function runtimeSteps(runtime) {
  return [
    {
      title: "Copy the protocol content",
      path: runtime.contentDir,
      apply() {
        ensureDirectory(runtime.contentDir);
        copyDirectory(runtime.protocolSrcDir, runtime.contentDir, name => name.endsWith(".md"));
      }
    },
    {
      title: "Copy the hook and status line runtime",
      path: runtime.root,
      apply() {
        ensureDirectory(join(runtime.root, "hooks"));
        ensureDirectory(join(runtime.root, "statusline"));
        copyInto(runtime.hookSrc, runtime.hookPath);
        copyInto(runtime.statuslineSrc, runtime.statuslinePath);
        copyInto(runtime.protocolRuntimeSrc, runtime.protocolRuntimePath);
      }
    }
  ];
}

export function planInstall(selection, options = {}, env = process.env, home = homedir()) {
  const runtime = runtimePaths(env, home);
  const resolved = { statusline: true, userProtocol: false, ...options };
  const plan = [{ target: "prumo", label: "Prumo runtime", steps: runtimeSteps(runtime) }];
  for (const id of selection) {
    const adapter = adapterById(id);
    if (!adapter) continue;
    plan.push({ target: adapter.id, label: adapter.label, steps: adapter.steps({ home, runtime, options: resolved }) });
  }
  return { runtime, plan };
}

export function applyPlan(plan, { dryRun = false, onStep = () => {} } = {}) {
  const results = [];
  for (const group of plan) {
    for (const step of group.steps) {
      const record = { target: group.target, label: group.label, title: step.title, path: step.path, status: "planned" };
      if (!dryRun) {
        try {
          step.apply();
          record.status = "applied";
        } catch (error) {
          record.status = "failed";
          record.error = error instanceof Error ? error.message : String(error);
        }
      }
      results.push(record);
      onStep(record);
    }
  }
  return results;
}
