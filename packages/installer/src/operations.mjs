import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PrumoError } from "@prumocode/runtime";
import { ADAPTERS, adapterById } from "./adapters/index.mjs";
import { detectTarget } from "./detect.mjs";
import { emptyJournal, mergeMutations, readJournal, recordTransaction, writeJournal } from "./journal.mjs";
import { RUNTIME_GROUP, planRuntimeHome, planRuntimeRemoval, verifyRuntimeHome } from "./runtime-home.mjs";
import { restoreSnapshot, runTransaction } from "./transaction.mjs";

export function resolveTargets(context, requested = [], { probe = false } = {}) {
  const detections = ADAPTERS.map(adapter => detectTarget(adapter, context.env, context.home, { probe }));
  if (requested.length === 0) {
    return { detections, selected: detections.filter(entry => entry.installed).map(entry => adapterById(entry.id)) };
  }
  const selected = [];
  for (const id of requested) {
    const adapter = adapterById(id);
    if (!adapter) throw new PrumoError("PRUMO_E_UNSUPPORTED_VERSION", `unknown target "${id}"; known targets: ${ADAPTERS.map(entry => entry.id).join(", ")}`);
    selected.push(adapter);
  }
  return { detections, selected };
}

function groupsFor(context, adapters, mode, journal) {
  const groups = [];
  if (mode !== "uninstall") {
    groups.push({ adapter: RUNTIME_GROUP, label: "Prumo runtime and protocol", steps: planRuntimeHome(context), verify: () => verifyRuntimeHome(context) });
  }
  for (const adapter of adapters) {
    const steps = mode === "uninstall" ? adapter.planUninstall(context, journal) : mode === "update" ? adapter.planUpdate(context) : adapter.planInstall(context);
    groups.push({ adapter: adapter.id, label: adapter.label, steps, verify: mode === "uninstall" ? undefined : () => adapter.verifyInstall(context) });
  }
  return groups;
}

export function install(context, { targets = [], dryRun = false, mode = "install", onPhase } = {}) {
  const { selected, detections } = resolveTargets(context, targets);
  if (selected.length === 0) throw new PrumoError("PRUMO_E_UNSUPPORTED_VERSION", "no supported agent detected; pass targets explicitly, e.g. prumo install claude");
  const groups = groupsFor(context, selected, mode, context.journal);
  const result = runTransaction({ operation: mode, groups, backupsDir: context.layout.backupsDir, dryRun, onPhase });
  if (!dryRun && result.status !== "planned") commitJournal(context, result, selected, mode);
  return { ...result, detections, targets: selected.map(adapter => adapter.id) };
}

export function update(context, options = {}) {
  const journal = context.journal;
  const targets = options.targets?.length ? options.targets : Object.keys(journal?.targets ?? {});
  if (targets.length === 0) throw new PrumoError("PRUMO_E_JOURNAL", "nothing to update: no install journal; run prumo install");
  const comparison = {
    protocol: { installed: journal?.protocolVersion, available: context.protocolVersion, installedHash: journal?.protocolHash, availableHash: context.protocolHash },
    runtime: { installed: journal?.runtimeVersion, available: context.versions.runtimeVersion },
    installer: { installed: journal?.installerVersion, available: context.versions.installerVersion }
  };
  const result = install(context, { ...options, targets, mode: "update" });
  return { ...result, comparison };
}

export function uninstall(context, { targets = [], all = false, dryRun = false, removeRuntime, onPhase } = {}) {
  const journal = context.journal;
  const requested = all ? Object.keys(journal?.targets ?? {}) : targets;
  if (requested.length === 0 && !all) throw new PrumoError("PRUMO_E_UNSUPPORTED_VERSION", "specify a target or --all, e.g. prumo uninstall claude");
  const adapters = requested.map(id => adapterById(id)).filter(Boolean);
  const groups = groupsFor(context, adapters, "uninstall", journal);
  const removingRuntime = removeRuntime ?? (all || (journal && Object.keys(journal.targets ?? {}).every(id => requested.includes(id))));
  if (removingRuntime) groups.push({ adapter: RUNTIME_GROUP, label: "Prumo runtime and protocol", steps: planRuntimeRemoval(context) });
  const result = runTransaction({ operation: "uninstall", groups, backupsDir: context.layout.backupsDir, dryRun, verify: false, onPhase });
  if (!dryRun && result.status !== "planned") {
    const next = journal ?? emptyJournal(versionsOf(context));
    for (const adapter of adapters) {
      const applied = result.plan.mutations.filter(entry => entry.adapter === adapter.id);
      const remaining = mergeMutations(next.targets[adapter.id]?.mutations, applied.map(entry => ({ ...entry, afterHash: entry.operation === "delete" ? undefined : entry.afterHash })));
      const kept = remaining.filter(entry => entry.ownership === "prumo-file");
      if (kept.length === 0) delete next.targets[adapter.id];
      else next.targets[adapter.id] = { ...next.targets[adapter.id], state: "PARTIAL", mutations: kept, updatedAt: new Date().toISOString() };
    }
    if (removingRuntime) next.runtime = { mutations: [] };
    recordTransaction(next, { id: result.backupId, at: new Date().toISOString(), operation: "uninstall", targets: requested, backup: result.backup, status: result.status });
    writeJournal(context.layout.installJournalPath, next);
    result.journal = next;
  }
  const conflicts = result.plan.conflicts;
  return { ...result, targets: requested, removedRuntime: removingRuntime, conflicts };
}

export function listBackups(context) {
  const directory = context.layout.backupsDir;
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter(entry => existsSync(join(directory, entry, "manifest.json")))
    .map(entry => {
      const manifest = JSON.parse(readFileSync(join(directory, entry, "manifest.json"), "utf8"));
      return { id: entry, operation: manifest.operation, createdAt: manifest.createdAt, files: manifest.entries.length, directory: join(directory, entry) };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function rollback(context, { id, dryRun = false } = {}) {
  const backups = listBackups(context);
  if (backups.length === 0) throw new PrumoError("PRUMO_E_ROLLBACK", "no backups to roll back to");
  const chosen = id ? backups.find(entry => entry.id === id) : backups.at(-1);
  if (!chosen) throw new PrumoError("PRUMO_E_ROLLBACK", `backup ${id} not found`);
  const manifest = JSON.parse(readFileSync(join(chosen.directory, "manifest.json"), "utf8"));
  if (dryRun) return { backup: chosen, manifest, dryRun: true, restored: 0 };
  const restored = restoreSnapshot(manifest);
  const journal = readJournal(context.layout.installJournalPath) ?? emptyJournal(versionsOf(context));
  recordTransaction(journal, { id: chosen.id, at: new Date().toISOString(), operation: "rollback", targets: [...new Set(manifest.entries.map(entry => entry.adapter))], backup: chosen.directory, status: "restored" });
  for (const target of Object.keys(journal.targets ?? {})) {
    if (manifest.entries.some(entry => entry.adapter === target)) journal.targets[target].state = "UNKNOWN";
  }
  writeJournal(context.layout.installJournalPath, journal);
  return { backup: chosen, manifest, restored };
}

function commitJournal(context, result, adapters, mode) {
  const journal = context.journal ?? emptyJournal(versionsOf(context));
  Object.assign(journal, versionsOf(context));
  journal.options = { ...context.options };
  const now = new Date().toISOString();
  const runtimeMutations = result.plan.mutations.filter(entry => entry.adapter === RUNTIME_GROUP);
  journal.runtime = { mutations: mergeMutations(journal.runtime?.mutations, runtimeMutations), updatedAt: now };
  for (const adapter of adapters) {
    const applied = result.plan.mutations.filter(entry => entry.adapter === adapter.id);
    const verification = result.verification?.find(entry => entry.adapter === adapter.id);
    const previous = journal.targets[adapter.id];
    journal.targets[adapter.id] = {
      state: verification?.state ?? previous?.state ?? "ACTIVE",
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
      mutations: mergeMutations(previous?.mutations, applied.map(entry => ({ step: entry.step, path: entry.path, kind: entry.kind, ownership: entry.ownership, beforeHash: entry.beforeHash, afterHash: entry.afterHash, backup: result.backup ?? null })))
    };
  }
  recordTransaction(journal, { id: result.backupId ?? null, at: now, operation: mode, targets: adapters.map(adapter => adapter.id), backup: result.backup ?? null, status: result.status });
  writeJournal(context.layout.installJournalPath, journal);
  result.journal = journal;
  context.journal = journal;
}

function versionsOf(context) {
  return { installerVersion: context.versions.installerVersion, runtimeVersion: context.versions.runtimeVersion, protocolVersion: context.protocolVersion, protocolHash: context.protocolHash };
}

export function diff(context, { targets = [], mode = "install" } = {}) {
  const { selected } = resolveTargets(context, targets);
  const groups = groupsFor(context, selected, mode, context.journal);
  const result = runTransaction({ operation: mode, groups, backupsDir: context.layout.backupsDir, dryRun: true });
  return { targets: selected.map(adapter => adapter.id), plan: redactPlan(result.plan) };
}

const SECRET_KEY = /(token|secret|password|passwd|api[-_]?key|authorization|credential)/i;

export function redactPlan(plan) {
  return {
    changes: plan.changes,
    conflicts: plan.conflicts,
    groups: plan.groups.map(group => ({
      adapter: group.adapter,
      label: group.label,
      steps: group.steps.map(step => ({ ...step, summary: step.summary.map(redactSummary) }))
    }))
  };
}

function redactSummary(line) {
  return SECRET_KEY.test(line) ? line.replace(/(=|:)\s*\S+/g, "$1 [redacted]") : line;
}
