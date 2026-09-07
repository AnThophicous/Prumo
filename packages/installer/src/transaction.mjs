import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { PrumoError } from "@prumocode/runtime";
import { ensureDirectory, hashText, writeTextAtomic } from "./fsops.mjs";

export const PHASES = ["plan", "snapshot", "stage", "validate", "apply", "verify", "commit"];

export function planSteps(groups) {
  const staged = new Map();
  const mutations = [];
  const conflicts = [];
  const groupPlans = [];
  for (const group of groups) {
    const entries = [];
    for (const step of group.steps) {
      const previouslyStaged = staged.get(step.path);
      const current = previouslyStaged ? previouslyStaged.next : readCurrent(step.path);
      const existedBefore = previouslyStaged ? previouslyStaged.existedBefore : current !== undefined;
      let result;
      try {
        result = step.compute(current === null ? undefined : current);
      } catch (error) {
        if (error instanceof PrumoError) throw error;
        throw new PrumoError("PRUMO_E_TRANSACTION", `${step.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (result.conflict) conflicts.push({ step: step.id, path: step.path, adapter: group.adapter, reason: result.conflict });
      const entry = { step: step.id, title: step.title, path: step.path, kind: step.kind, ownership: step.ownership, adapter: group.adapter, changed: Boolean(result.changed), summary: result.summary ?? [], conflict: result.conflict };
      if (result.changed) {
        if (result.next !== null && step.validate) step.validate(result.next);
        const before = current === undefined || current === null ? undefined : hashText(current);
        entry.beforeHash = before;
        entry.afterHash = result.next === null ? undefined : hashText(result.next);
        entry.operation = result.next === null ? "delete" : !existedBefore ? "create" : "modify";
        staged.set(step.path, { next: result.next, existedBefore, adapter: group.adapter, steps: [...(previouslyStaged?.steps ?? []), step.id] });
        mutations.push(entry);
      }
      entries.push(entry);
    }
    groupPlans.push({ adapter: group.adapter, label: group.label, steps: entries, verify: group.verify });
  }
  return { groups: groupPlans, staged, mutations, conflicts, changes: mutations.length };
}

function readCurrent(path) {
  if (!existsSync(path)) return undefined;
  const stats = statSync(path);
  if (!stats.isFile()) throw new PrumoError("PRUMO_E_FOREIGN_FILE", `${path} exists and is not a regular file; Prumo will not touch it`);
  return readFileSync(path, "utf8");
}

export function snapshot(plan, backupsDir, { operation, id }) {
  const stamp = id ?? new Date().toISOString().replace(/[:.]/g, "-");
  const directory = join(backupsDir, stamp);
  const entries = [];
  let index = 0;
  for (const [path, staged] of plan.staged) {
    if (!staged.existedBefore) {
      entries.push({ path, adapter: staged.adapter, backup: null, existed: false });
      continue;
    }
    index += 1;
    const target = join(directory, staged.adapter, `${String(index).padStart(3, "0")}-${basename(path)}`);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(path, target);
    entries.push({ path, adapter: staged.adapter, backup: target, existed: true, hash: hashText(readFileSync(path, "utf8")) });
  }
  const manifest = { id: stamp, operation, createdAt: new Date().toISOString(), entries };
  ensureDirectory(directory);
  writeTextAtomic(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { directory, manifest };
}

export function restoreSnapshot(manifest) {
  const failures = [];
  for (const entry of manifest.entries) {
    try {
      if (!entry.existed) {
        rmSync(entry.path, { force: true });
        continue;
      }
      ensureDirectory(dirname(entry.path));
      copyFileSync(entry.backup, entry.path);
    } catch (error) {
      failures.push({ path: entry.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (failures.length > 0) throw new PrumoError("PRUMO_E_ROLLBACK", `rollback left ${failures.length} file(s) unrestored`, { failures });
  return manifest.entries.length;
}

export function applyPlan(plan) {
  const applied = [];
  for (const [path, staged] of plan.staged) {
    if (staged.next === null) rmSync(path, { force: true });
    else writeTextAtomic(path, staged.next);
    applied.push(path);
  }
  return applied;
}

export function runTransaction({ operation, groups, backupsDir, dryRun = false, verify = true, acceptStates = ["ACTIVE"], onPhase = () => {} }) {
  onPhase("plan");
  const plan = planSteps(groups);
  if (dryRun) return { operation, plan, dryRun: true, status: "planned" };
  if (plan.changes === 0) {
    const verification = verify ? verifyGroups(plan) : [];
    return { operation, plan, status: "noop", verification };
  }
  onPhase("snapshot");
  const backup = snapshot(plan, backupsDir, { operation });
  onPhase("apply");
  try {
    applyPlan(plan);
  } catch (error) {
    onPhase("rollback");
    restoreSnapshot(backup.manifest);
    throw new PrumoError("PRUMO_E_TRANSACTION", `${operation} failed while applying changes and was rolled back: ${error instanceof Error ? error.message : String(error)}`, { backup: backup.directory });
  }
  onPhase("verify");
  const verification = verify ? verifyGroups(plan) : [];
  const failed = verification.filter(entry => entry.state && !acceptStates.includes(entry.state));
  if (failed.length > 0) {
    onPhase("rollback");
    restoreSnapshot(backup.manifest);
    const detail = failed.map(entry => `${entry.adapter}: ${entry.state} (${entry.checks.filter(item => item.status === "FAIL").map(item => `${item.id} ${item.detail}`).join("; ")})`).join(" | ");
    throw new PrumoError("PRUMO_E_TRANSACTION", `${operation} verification failed and was rolled back: ${detail}`, { backup: backup.directory, verification });
  }
  onPhase("commit");
  return { operation, plan, status: "applied", backup: backup.directory, backupId: backup.manifest.id, verification };
}

function verifyGroups(plan) {
  return plan.groups.filter(group => typeof group.verify === "function").map(group => ({ adapter: group.adapter, ...group.verify() }));
}
