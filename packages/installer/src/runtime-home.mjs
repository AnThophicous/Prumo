import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { check, deleteStep, fileStep, summarizeState, verifyOwnedFile } from "./adapters/contract.mjs";
import { runtimeFiles } from "./environment.mjs";
import { listFiles } from "./fsops.mjs";

export const RUNTIME_GROUP = "runtime";

export function planRuntimeHome(context) {
  const steps = [];
  for (const [relativePath, content] of runtimeFiles(context.root)) {
    steps.push(fileStep({ id: `runtime:${relativePath}`, title: `Install runtime ${relativePath}`, path: join(context.layout.runtimeDir, ...relativePath.split("/")), content, adapter: RUNTIME_GROUP }));
  }
  for (const [relativePath, content] of context.artifacts) {
    if (relativePath.startsWith("readme-block") || relativePath === "coverage.md") continue;
    steps.push(fileStep({ id: `protocol:${relativePath}`, title: `Install protocol ${relativePath}`, path: join(context.layout.protocolDir, ...relativePath.split("/")), content, adapter: RUNTIME_GROUP }));
  }
  const stale = staleProtocolFiles(context);
  for (const relativePath of stale) {
    steps.push(deleteStep({ id: `protocol:${relativePath}`, title: `Remove stale protocol ${relativePath}`, path: join(context.layout.protocolDir, ...relativePath.split("/")), adapter: RUNTIME_GROUP }));
  }
  return steps;
}

function staleProtocolFiles(context) {
  const expected = new Set([...context.artifacts.keys()]);
  return listFiles(context.layout.protocolDir).filter(relativePath => !expected.has(relativePath));
}

export function planRuntimeRemoval(context) {
  const steps = [];
  for (const relativePath of listFiles(context.layout.runtimeDir)) {
    steps.push(deleteStep({ id: `runtime:${relativePath}`, title: `Remove runtime ${relativePath}`, path: join(context.layout.runtimeDir, ...relativePath.split("/")), adapter: RUNTIME_GROUP }));
  }
  for (const relativePath of listFiles(context.layout.protocolDir)) {
    steps.push(deleteStep({ id: `protocol:${relativePath}`, title: `Remove protocol ${relativePath}`, path: join(context.layout.protocolDir, ...relativePath.split("/")), adapter: RUNTIME_GROUP }));
  }
  return steps;
}

export function verifyRuntimeHome(context) {
  const checks = [
    verifyOwnedFile("runtime.hook", context.layout.hookPath, runtimeFiles(context.root).get("hooks/prumo-hook.mjs")),
    verifyOwnedFile("runtime.statusline", context.layout.statuslinePath, runtimeFiles(context.root).get("statusline/prumo-statusline.mjs")),
    verifyOwnedFile("protocol.manifest", context.layout.manifestPath, context.artifacts.get("protocol.manifest.json")),
    verifyOwnedFile("protocol.kernel", context.layout.kernelPath, context.artifacts.get("kernel/PRUMO-KERNEL.md"))
  ];
  if (existsSync(context.layout.manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(context.layout.manifestPath, "utf8"));
      checks.push(check("protocol.hash", manifest.sourceHash === context.protocolHash, manifest.sourceHash === context.protocolHash ? `sha256:${manifest.sourceHash.slice(0, 12)}` : `installed ${manifest.sourceHash?.slice(0, 12)} differs from repository ${context.protocolHash.slice(0, 12)}`));
    } catch (error) {
      checks.push({ ...check("protocol.hash", false, `manifest unreadable: ${error instanceof Error ? error.message : String(error)}`), broken: true });
    }
  }
  return { state: summarizeState(checks, { requiredIds: ["runtime.hook", "protocol.manifest", "protocol.kernel"], optionalIds: ["runtime.statusline", "protocol.hash"] }), checks };
}
