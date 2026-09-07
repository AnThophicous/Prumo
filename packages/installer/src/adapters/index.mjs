import { claudeAdapter } from "./claude.mjs";
import { codexAdapter } from "./codex.mjs";
import { cursorAdapter } from "./cursor.mjs";
import { geminiAdapter } from "./gemini.mjs";
import { grokAdapter } from "./grok.mjs";
import { opencodeAdapter } from "./opencode.mjs";

export const ADAPTERS = [claudeAdapter, codexAdapter, cursorAdapter, grokAdapter, geminiAdapter, opencodeAdapter];

export function adapterById(id) {
  return ADAPTERS.find(adapter => adapter.id === id);
}

export function capabilityRegistry() {
  return Object.fromEntries(ADAPTERS.map(adapter => [adapter.id, { label: adapter.label, commands: adapter.commands, capabilities: adapter.capabilities }]));
}

export { claudeAdapter, codexAdapter, cursorAdapter, geminiAdapter, grokAdapter, opencodeAdapter };
