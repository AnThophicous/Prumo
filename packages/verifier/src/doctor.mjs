import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { detectBridge, extractBlockFromArtifact, findMapSource, lintMapSource, parseMapSource, sha256 } from "@prumocode/runtime";
import { lintRepository } from "./lint.mjs";

export function runDoctor({ context, adapters = [], verifyRuntimeHome, workspace = process.cwd(), includeProject = true }) {
  const checks = [];
  const lint = lintRepository(context.root);
  const compiled = lint.compiled;
  const isProtocolFinding = entry => !entry.code.startsWith("generated") && !entry.code.startsWith("readme");
  const protocolErrors = lint.errors.filter(isProtocolFinding);
  checks.push(result("protocol integrity", protocolErrors.length === 0 ? "PASS" : "FAIL", `${compiled.manifest.ruleCount} rules, ${compiled.manifest.ruleRange.first} to ${compiled.manifest.ruleRange.last}`, protocolErrors.map(entry => entry.message), { exit: "PROTOCOL_INTEGRITY" }));
  const generated = lint.findings.filter(entry => entry.code.startsWith("generated"));
  checks.push(result("generated files", generated.length === 0 ? "PASS" : "FAIL", generated.length === 0 ? `${compiled.files.size} artifacts fresh` : `${generated.length} stale or missing`, generated.map(entry => entry.message), { exit: "DRIFT" }));
  const readme = lint.findings.filter(entry => entry.code.startsWith("readme"));
  checks.push(result("README metadata", readme.length === 0 ? "PASS" : readme.every(entry => entry.severity === "warning") ? "WARN" : "FAIL", readme.length === 0 ? "generated block current" : readme[0].message));
  checks.push(result("kernel budget", compiled.manifest.kernel.tokens <= 2500 ? "PASS" : "FAIL", `${compiled.manifest.kernel.tokens} tokens (budget 2500)`));

  const installed = readInstalledManifest(context.layout.manifestPath);
  if (!installed.manifest) {
    checks.push(result("installed protocol", "FAIL", installed.error ?? `no protocol at ${context.layout.protocolDir}; run prumo install`, [], { broken: true }));
  } else {
    const same = installed.manifest.sourceHash === compiled.sourceHash;
    checks.push(result("installed protocol", same ? "PASS" : "WARN", same ? `protocol ${installed.manifest.protocolVersion} sha256:${installed.manifest.sourceHash.slice(0, 12)}` : `installed ${installed.manifest.protocolVersion} (${installed.manifest.sourceHash.slice(0, 12)}) differs from repository ${compiled.protocolVersion} (${compiled.sourceHash.slice(0, 12)}); run prumo update`));
  }

  if (verifyRuntimeHome) {
    const runtime = verifyRuntimeHome(context);
    for (const check of runtime.checks) checks.push(result(`runtime ${check.id}`, check.status, check.detail, [], { broken: check.broken, drift: check.drift }));
  }
  checks.push(runtimeExecutable(context.layout.hookPath));

  for (const adapter of adapters) {
    let target;
    try {
      target = adapter.verifyInstall(context);
    } catch (error) {
      checks.push(result(adapter.label, "FAIL", error instanceof Error ? error.message : String(error), [], { broken: true }));
      continue;
    }
    const journalState = context.journal?.targets?.[adapter.id];
    if (!journalState && target.state === "ABSENT") {
      checks.push(result(adapter.label, "SKIP", "not installed"));
      continue;
    }
    for (const check of target.checks) checks.push(result(`${adapter.label} ${check.id.split(".").slice(1).join(".")}`, check.status, check.detail, [], { broken: check.broken, drift: check.drift }));
    checks.push(result(`${adapter.label} state`, stateLevel(target.state), target.state, [], { drift: target.state === "DRIFTED", broken: target.state === "BROKEN", partial: target.state === "PARTIAL" }));
  }

  if (context.journal) {
    const drifted = journalDrift(context.journal);
    checks.push(result("journal integrity", drifted.length === 0 ? "PASS" : "FAIL", drifted.length === 0 ? `${countMutations(context.journal)} owned mutations match` : `${drifted.length} Prumo-owned file(s) edited outside the installer`, drifted, { drift: drifted.length > 0 }));
  }

  if (includeProject) {
    for (const check of projectChecks({ context, adapters, workspace, compiled })) checks.push(check);
  }

  return { checks, summary: summarize(checks), ruleCount: compiled.manifest.ruleCount, protocolVersion: compiled.protocolVersion };
}

function projectChecks({ context, adapters, workspace, compiled }) {
  const checks = [];
  const files = new Set(adapters.map(adapter => adapter.capabilities.projectInstructions).filter(Boolean));
  if (files.size === 0) files.add("AGENTS.md");
  for (const file of files) {
    const cli = file === "CLAUDE.md" ? "claude" : file === "GEMINI.md" ? "gemini" : "codex";
    const artifact = compiled.files.get(`agents/${file}`);
    const block = artifact ? extractBlockFromArtifact(artifact) : undefined;
    const bridge = detectBridge({ workspace, cli, currentVersion: compiled.protocolVersion, currentHash: block?.hash, seedingEnabled: context.env.PRUMO_SEED !== "0" });
    const level = bridge.state === "ACTIVE" ? (bridge.outdated ? "WARN" : "PASS") : bridge.state === "ABSENT" || bridge.state === "DISABLED" ? "SKIP" : bridge.state === "FOREIGN" ? "WARN" : "FAIL";
    checks.push(result(`project bridge ${file}`, level, `${bridge.state}: ${bridge.reason}`, [], { drift: bridge.state === "DRIFTED" }));
  }
  const mapsource = findMapSource(workspace);
  if (!mapsource) {
    checks.push(result("MapSource", "SKIP", "no MapSource.md in the workspace"));
  } else {
    const text = readFileSync(mapsource, "utf8");
    const parsed = parseMapSource(text);
    const findings = lintMapSource(text);
    const errors = findings.filter(entry => entry.severity === "error");
    checks.push(result("MapSource schema", errors.length === 0 ? (findings.length === 0 ? "PASS" : "WARN") : "FAIL", errors.length === 0 ? `schema ${parsed.frontMatter?.schema ?? "?"}, ${Buffer.byteLength(text, "utf8")} bytes` : `${errors.length} schema error(s)`, findings.map(entry => entry.message)));
  }
  return checks;
}

function runtimeExecutable(hookPath) {
  if (!existsSync(hookPath)) return result("runtime executable", "FAIL", `${hookPath} missing`, [], { broken: true });
  try {
    execFileSync(process.execPath, ["--check", hookPath], { stdio: ["ignore", "ignore", "pipe"], timeout: 5000 });
    return result("runtime executable", "PASS", "hook parses under the current Node");
  } catch (error) {
    return result("runtime executable", "FAIL", `node --check failed: ${String(error.stderr ?? error.message).trim().split(/\r?\n/)[0]}`, [], { broken: true });
  }
}

function journalDrift(journal) {
  const drifted = [];
  const groups = [journal.runtime, ...Object.values(journal.targets ?? {})];
  for (const group of groups) {
    for (const mutation of group?.mutations ?? []) {
      if (mutation.ownership !== "prumo-file" || !mutation.afterHash) continue;
      if (!existsSync(mutation.path)) {
        drifted.push(`${mutation.path} missing`);
        continue;
      }
      const hash = sha256(readFileSync(mutation.path, "utf8"));
      if (hash !== mutation.afterHash) drifted.push(`${mutation.path} modified`);
    }
  }
  return drifted;
}

function countMutations(journal) {
  return [journal.runtime, ...Object.values(journal.targets ?? {})].reduce((sum, group) => sum + (group?.mutations?.length ?? 0), 0);
}

function readInstalledManifest(path) {
  if (!existsSync(path)) return {};
  try {
    return { manifest: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    return { error: `installed manifest unreadable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function stateLevel(state) {
  if (state === "ACTIVE") return "PASS";
  if (state === "PARTIAL") return "WARN";
  return "FAIL";
}

function result(name, status, detail, details = [], flags = {}) {
  return { name, status, detail, details, ...flags };
}

export function summarize(checks) {
  const counts = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  for (const check of checks) counts[check.status] = (counts[check.status] ?? 0) + 1;
  let exit = "OK";
  if (checks.some(check => check.status === "FAIL" && check.exit === "PROTOCOL_INTEGRITY")) exit = "PROTOCOL_INTEGRITY";
  else if (checks.some(check => check.status === "FAIL" && check.broken)) exit = "FAILED";
  else if (checks.some(check => check.status === "FAIL" && (check.drift || check.exit === "DRIFT"))) exit = "DRIFT";
  else if (checks.some(check => check.status === "FAIL")) exit = "FAILED";
  else if (checks.some(check => check.partial)) exit = "PARTIAL";
  return { ...counts, exit, healthy: counts.FAIL === 0 };
}
