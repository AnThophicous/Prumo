import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFromRepository } from "@prumocode/compiler";
import { PrumoError, layout as runtimeLayout } from "@prumocode/runtime";
import { readJournal } from "./journal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export function repositoryRoot() {
  let current = HERE;
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(current, "content", "PRUMO.md")) && existsSync(join(current, "packages", "runtime"))) return current;
    current = dirname(current);
  }
  throw new PrumoError("PRUMO_E_PROTOCOL_MISSING", "cannot locate the Prumo repository root (content/PRUMO.md) from the installer");
}

export function packageVersion(directory) {
  const path = join(directory, "package.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).version : "0.0.0";
}

export function versions(root = repositoryRoot()) {
  return {
    installerVersion: packageVersion(join(root, "packages", "installer")),
    runtimeVersion: packageVersion(join(root, "packages", "runtime")),
    compilerVersion: packageVersion(join(root, "packages", "compiler"))
  };
}

export function compileArtifacts(root = repositoryRoot()) {
  const compiled = compileFromRepository(root);
  const errors = compiled.findings.filter(finding => finding.severity === "error");
  if (errors.length > 0) {
    throw new PrumoError("PRUMO_E_PROTOCOL_MISSING", `the canonical protocol fails lint with ${errors.length} error(s); refusing to install a broken protocol`, { findings: errors });
  }
  return compiled;
}

export function runtimeFiles(root = repositoryRoot()) {
  const runtimeDir = join(root, "packages", "runtime");
  const files = new Map();
  const walk = directory => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        if (entry === "node_modules" || entry === "test") continue;
        walk(path);
        continue;
      }
      if (!/\.(mjs|json|md)$/.test(entry)) continue;
      files.set(relative(runtimeDir, path).replaceAll("\\", "/"), readFileSync(path, "utf8"));
    }
  };
  walk(runtimeDir);
  return files;
}

export function buildContext({ env = process.env, home = homedir(), platform = process.platform, options = {}, root = repositoryRoot(), compiled } = {}) {
  const layout = runtimeLayout(env, home);
  const artifacts = compiled ?? compileArtifacts(root);
  const journal = readJournal(layout.installJournalPath);
  const resolvedOptions = {
    statusline: options.statusline ?? journal?.options?.statusline ?? true,
    userProtocol: options.userProtocol ?? journal?.options?.userProtocol ?? false
  };
  return {
    env,
    home,
    platform,
    layout,
    root,
    journal,
    options: resolvedOptions,
    compiled: artifacts,
    artifacts: artifacts.files,
    manifest: artifacts.manifest,
    protocolVersion: artifacts.protocolVersion,
    protocolHash: artifacts.sourceHash,
    versions: versions(root)
  };
}
