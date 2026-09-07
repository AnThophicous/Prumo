import { existsSync, readFileSync } from "node:fs";
import { PrumoError } from "@prumocode/runtime";
import { writeTextAtomic } from "./fsops.mjs";

export const JOURNAL_SCHEMA = 1;

export function emptyJournal({ installerVersion, runtimeVersion, protocolVersion, protocolHash } = {}) {
  return { schema: JOURNAL_SCHEMA, installerVersion, runtimeVersion, protocolVersion, protocolHash, updatedAt: undefined, options: {}, runtime: { mutations: [] }, targets: {}, transactions: [] };
}

export function readJournal(path) {
  if (!existsSync(path)) return undefined;
  try {
    const journal = JSON.parse(readFileSync(path, "utf8"));
    if (journal.schema !== JOURNAL_SCHEMA) throw new PrumoError("PRUMO_E_JOURNAL", `install journal schema ${journal.schema} is not supported by this installer (expected ${JOURNAL_SCHEMA})`);
    return journal;
  } catch (error) {
    if (error instanceof PrumoError) throw error;
    throw new PrumoError("PRUMO_E_JOURNAL", `install journal unreadable at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function writeJournal(path, journal) {
  journal.updatedAt = new Date().toISOString();
  writeTextAtomic(path, `${JSON.stringify(journal, null, 2)}\n`);
  return journal;
}

export function recordTransaction(journal, transaction) {
  journal.transactions = [...(journal.transactions ?? []), transaction].slice(-50);
  return journal;
}

export function mergeMutations(existing = [], applied = []) {
  const byStep = new Map(existing.map(entry => [entry.step, entry]));
  for (const entry of applied) {
    if (entry.afterHash === undefined) byStep.delete(entry.step);
    else byStep.set(entry.step, { ...byStep.get(entry.step), ...entry });
  }
  return [...byStep.values()];
}
