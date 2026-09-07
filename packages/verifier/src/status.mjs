import { existsSync, readFileSync } from "node:fs";
import { estimateTokens } from "@prumocode/compiler";
import { detectBridge, extractBlockFromArtifact, findMapSource, lintMapSource, readProjectState, routeChapters, workingSetTokens } from "@prumocode/runtime";

export function runStatus({ context, adapters = [], detections = [], workspace = process.cwd(), task, files = [], signals = [], full = false }) {
  const installed = readInstalled(context.layout.manifestPath);
  const manifest = installed ?? context.manifest;
  const targets = adapters.map(adapter => {
    const detection = detections.find(entry => entry.id === adapter.id);
    const journalled = context.journal?.targets?.[adapter.id];
    if (!journalled && !detection?.installed) return { id: adapter.id, label: adapter.label, state: "NOT INSTALLED", reason: "agent not detected and no Prumo journal entry" };
    if (!journalled) return { id: adapter.id, label: adapter.label, state: "NOT INSTALLED", reason: `${detection.evidence}; Prumo not installed for this agent` };
    if (context.env[`PRUMO_DISABLE_${adapter.id.toUpperCase()}`] === "1") return { id: adapter.id, label: adapter.label, state: "DISABLED", reason: "disabled by environment" };
    const verification = adapter.verifyInstall(context);
    const failing = verification.checks.filter(check => check.status === "FAIL").map(check => `${check.id.split(".").slice(1).join(".")}: ${check.detail}`);
    return { id: adapter.id, label: adapter.label, state: verification.state, reason: failing.join("; ") || "verified", detected: detection?.evidence };
  });

  const bridges = uniqueBridgeFiles(adapters).map(file => {
    const cli = file === "CLAUDE.md" ? "claude" : file === "GEMINI.md" ? "gemini" : "codex";
    const artifact = context.artifacts.get(`agents/${file}`);
    const block = artifact ? extractBlockFromArtifact(artifact) : undefined;
    const bridge = detectBridge({ workspace, cli, currentVersion: manifest.protocolVersion, currentHash: block?.hash, seedingEnabled: context.env.PRUMO_SEED !== "0" });
    return { file, state: bridge.state, reason: bridge.reason, version: bridge.version };
  });

  const mapsourcePath = findMapSource(workspace);
  const mapsource = mapsourcePath
    ? (() => {
        const text = readFileSync(mapsourcePath, "utf8");
        const findings = lintMapSource(text);
        const bytes = Buffer.byteLength(text, "utf8");
        return { path: mapsourcePath, bytes, state: findings.some(entry => entry.severity === "error") ? "INVALID" : bytes > 48 * 1024 ? "OVERSIZED" : bytes > 32 * 1024 ? "LARGE" : "current", findings: findings.length };
      })()
    : { state: "absent" };

  const route = routeChapters(manifest, { task: task ?? "", files, signals, full });
  const chapterTokens = Object.fromEntries(manifest.chapters.map(chapter => [chapter.id, chapter.tokens ?? estimateTokens(context.artifacts.get(`chapters/${chapter.id}.md`) ?? "")]));
  const projectState = readProjectState(workspace, context.env, context.home);
  const stateTokens = projectState ? estimateTokens(JSON.stringify(projectState)) : 0;
  const tokens = workingSetTokens(route, { kernelTokens: manifest.kernel.tokens, chapterTokens, stateTokens });

  return {
    installer: context.versions.installerVersion,
    runtime: { version: context.journal?.runtimeVersion ?? context.versions.runtimeVersion, installed: existsSync(context.layout.hookPath) },
    protocol: { version: manifest.protocolVersion, hash: manifest.sourceHash, installed: Boolean(installed), repositoryVersion: context.protocolVersion, repositoryHash: context.protocolHash, drift: installed ? installed.sourceHash !== context.protocolHash : undefined },
    workspace,
    bridges,
    mapsource,
    targets,
    working: {
      kernel: "active",
      chapters: route.chapters.map(chapter => ({ id: chapter.id, reasons: chapter.reasons })),
      refused: route.refused,
      rules: { active: route.ruleIds.length, total: manifest.ruleCount },
      tokens
    }
  };
}

function uniqueBridgeFiles(adapters) {
  const files = new Set(adapters.map(adapter => adapter.capabilities?.projectInstructions).filter(Boolean));
  if (files.size === 0) files.add("AGENTS.md");
  return [...files];
}

function readInstalled(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}
