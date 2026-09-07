import { existsSync, readFileSync } from "node:fs";
import { PrumoError, appendManagedBlock, extractBlockFromArtifact, parseManagedBlock, removeManagedBlock, replaceManagedBlock } from "@prumocode/runtime";
import { JsoncError, appendToArray, getPath, parseJsonc, readJsoncObject, removeArrayItems, removeKey, setPath } from "../config/jsonc.mjs";
import { readTomlValue } from "../config/toml.mjs";
import { hashText, nodeCommand, splitCommand } from "../fsops.mjs";

export const HOOK_MARKER = "prumo-hook.mjs";
export const STATUSLINE_MARKER = "prumo-statusline.mjs";
export const OWNERSHIP = Object.freeze({ FILE: "prumo-file", CONFIG_ENTRY: "config-entry", MANAGED_BLOCK: "managed-block" });
export const TARGET_STATES = Object.freeze(["ABSENT", "ACTIVE", "PARTIAL", "DRIFTED", "BROKEN", "DISABLED"]);

export function hookCommand(context, cli, event) {
  return nodeCommand(context.layout.hookPath, [`--cli=${cli}`, `--event=${event}`], context.platform);
}

export function statuslineCommand(context) {
  return nodeCommand(context.layout.statuslinePath, [], context.platform);
}

export function isPrumoCommand(command, marker = HOOK_MARKER) {
  return typeof command === "string" && command.includes(marker);
}

export function commandTargets(command, scriptPath) {
  const words = splitCommand(command);
  if (words.length === 0) return false;
  const normalize = value => value.replaceAll("\\", "/").toLowerCase();
  return /(^|\/)node(\.exe)?$/i.test(words[0]) && words.length > 1 && normalize(words[1]) === normalize(scriptPath);
}

export function fileStep({ id, title, path, content, adapter }) {
  return {
    id,
    title,
    path,
    adapter,
    kind: "file",
    ownership: OWNERSHIP.FILE,
    compute(current) {
      const normalizedContent = content;
      const changed = current !== normalizedContent;
      return { next: normalizedContent, changed, summary: [current === undefined ? "+ create" : changed ? "~ rewrite" : "= unchanged"] };
    }
  };
}

export function deleteStep({ id, title, path, adapter, ownership = OWNERSHIP.FILE, guardHash }) {
  return {
    id,
    title,
    path,
    adapter,
    kind: "delete",
    ownership,
    compute(current) {
      if (current === undefined) return { next: undefined, changed: false, summary: ["= absent"] };
      if (guardHash && hashText(current) !== guardHash) {
        return { next: current, changed: false, conflict: `file was modified outside Prumo; left in place`, summary: ["! kept (modified outside Prumo)"] };
      }
      return { next: null, changed: true, summary: ["- delete"] };
    }
  };
}

export function jsoncStep({ id, title, path, adapter, mutate, describe }) {
  return {
    id,
    title,
    path,
    adapter,
    kind: "config",
    ownership: OWNERSHIP.CONFIG_ENTRY,
    compute(current) {
      const text = current ?? "";
      let next;
      let summary;
      try {
        ({ text: next, summary } = mutate(text));
      } catch (error) {
        if (error instanceof JsoncError) throw new PrumoError("PRUMO_E_CONFIG_PARSE", `${path}: ${error.message}`);
        throw error;
      }
      return { next, changed: next !== text, summary: summary ?? (next !== text ? [describe ?? "~ edit"] : ["= unchanged"]) };
    },
    validate(next) {
      try {
        parseJsonc(next);
      } catch (error) {
        throw new PrumoError("PRUMO_E_CONFIG_PARSE", `${path}: staged config does not parse (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  };
}

export function tomlStep({ id, title, path, adapter, mutate, describe }) {
  return {
    id,
    title,
    path,
    adapter,
    kind: "config",
    ownership: OWNERSHIP.CONFIG_ENTRY,
    compute(current) {
      const text = current ?? "";
      const { text: next, summary } = mutate(text);
      return { next, changed: next !== text, summary: summary ?? (next !== text ? [describe ?? "~ edit"] : ["= unchanged"]) };
    }
  };
}

export function addGroupedHook(text, eventPath, entry, marker = HOOK_MARKER) {
  const groups = getPath(text, eventPath);
  const present = Array.isArray(groups) && groups.some(group => Array.isArray(group?.hooks) && group.hooks.some(hook => isPrumoCommand(hook?.command, marker)));
  if (present) {
    const current = groups.flatMap(group => group.hooks ?? []).find(hook => isPrumoCommand(hook?.command, marker));
    if (current.command === entry.command) return { text, summary: [`= ${eventPath.at(-1)} hook already registered`] };
    const stripped = removeArrayItems(text, eventPath, group => Array.isArray(group?.hooks) && group.hooks.some(hook => isPrumoCommand(hook?.command, marker))).text;
    return { text: appendToArray(stripped, eventPath, { hooks: [entry] }), summary: [`~ ${eventPath.at(-1)} hook command updated`] };
  }
  return { text: appendToArray(text, eventPath, { hooks: [entry] }), summary: [`+ ${eventPath.at(-1)} Prumo hook`] };
}

export function removeGroupedHook(text, eventPath, marker = HOOK_MARKER) {
  const groups = getPath(text, eventPath);
  if (!Array.isArray(groups)) return { text, summary: ["= no hook registered"] };
  let next = text;
  let removed = 0;
  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) continue;
    const prumo = group.hooks.filter(hook => isPrumoCommand(hook?.command, marker));
    if (prumo.length === 0) continue;
    if (prumo.length === group.hooks.length) {
      next = removeArrayItems(next, eventPath, candidate => JSON.stringify(candidate) === JSON.stringify(group)).text;
    } else {
      const index = getPath(next, eventPath).findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(group));
      next = removeArrayItems(next, [...eventPath, index, "hooks"], hook => isPrumoCommand(hook?.command, marker)).text;
    }
    removed += prumo.length;
  }
  if (removed > 0 && Array.isArray(getPath(next, eventPath)) && getPath(next, eventPath).length === 0) next = removeKey(next, eventPath).text;
  if (removed > 0 && isEmptyObject(getPath(next, eventPath.slice(0, -1)))) next = removeKey(next, eventPath.slice(0, -1)).text;
  return { text: next, summary: removed ? [`- ${eventPath.at(-1)} Prumo hook`] : ["= no hook registered"] };
}

export function addFlatHook(text, eventPath, entry, marker = HOOK_MARKER) {
  const items = getPath(text, eventPath);
  const current = Array.isArray(items) ? items.find(item => isPrumoCommand(item?.command, marker)) : undefined;
  if (current) {
    if (current.command === entry.command) return { text, summary: [`= ${eventPath.at(-1)} hook already registered`] };
    const stripped = removeArrayItems(text, eventPath, item => isPrumoCommand(item?.command, marker)).text;
    return { text: appendToArray(stripped, eventPath, entry), summary: [`~ ${eventPath.at(-1)} hook command updated`] };
  }
  return { text: appendToArray(text, eventPath, entry), summary: [`+ ${eventPath.at(-1)} Prumo hook`] };
}

export function removeFlatHook(text, eventPath, marker = HOOK_MARKER) {
  const result = removeArrayItems(text, eventPath, item => isPrumoCommand(item?.command, marker));
  let next = result.text;
  if (result.removed > 0 && Array.isArray(getPath(next, eventPath)) && getPath(next, eventPath).length === 0) next = removeKey(next, eventPath).text;
  if (result.removed > 0 && isEmptyObject(getPath(next, eventPath.slice(0, -1)))) next = removeKey(next, eventPath.slice(0, -1)).text;
  return { text: next, summary: result.removed ? [`- ${eventPath.at(-1)} Prumo hook`] : ["= no hook registered"] };
}

export function setStatusLine(text, path, value, marker = STATUSLINE_MARKER) {
  const current = getPath(text, path);
  if (current && typeof current === "object" && isPrumoCommand(current.command, marker) && current.command === value.command) return { text, summary: ["= status line already Prumo"] };
  if (current !== undefined && !(typeof current === "object" && current !== null && isPrumoCommand(current.command, marker))) {
    return { text, summary: ["= status line already set by the user (preserved)"] };
  }
  return { text: setPath(text, path, value), summary: [current ? "~ status line updated" : "+ status line"] };
}

export function unsetStatusLine(text, path, marker = STATUSLINE_MARKER) {
  const current = getPath(text, path);
  if (!current || typeof current !== "object" || !isPrumoCommand(current.command, marker)) return { text, summary: ["= status line not owned by Prumo"] };
  return { text: removeKey(text, path).text, summary: ["- Prumo status line"] };
}

export function managedBlockStep({ id, title, path, adapter, artifactText }) {
  const block = extractBlockFromArtifact(artifactText);
  return {
    id,
    title,
    path,
    adapter,
    kind: "managed-block",
    ownership: OWNERSHIP.MANAGED_BLOCK,
    compute(current) {
      if (current === undefined) return { next: artifactText.replace(/\r\n?/g, "\n"), changed: true, summary: ["+ create with Prumo managed block"] };
      const parsed = parseManagedBlock(current);
      if (parsed.present && parsed.valid && parsed.declaredHash === block.hash) return { next: current, changed: false, summary: ["= managed block current"] };
      const next = parsed.present ? replaceManagedBlock(current, block.text) : appendManagedBlock(current, block.text);
      return { next, changed: next !== current, summary: [parsed.present ? "~ managed block updated" : "+ managed block appended (foreign content preserved)"] };
    }
  };
}

export function removeManagedBlockStep({ id, title, path, adapter }) {
  return {
    id,
    title,
    path,
    adapter,
    kind: "managed-block",
    ownership: OWNERSHIP.MANAGED_BLOCK,
    compute(current) {
      if (current === undefined) return { next: undefined, changed: false, summary: ["= absent"] };
      const result = removeManagedBlock(current);
      if (!result.removed) return { next: current, changed: false, summary: ["= no Prumo managed block (foreign file preserved)"] };
      if (result.empty) return { next: null, changed: true, summary: ["- delete (file contained only the Prumo block)"] };
      return { next: result.text, changed: true, summary: ["- managed block removed (foreign content preserved)"] };
    }
  };
}

export function verifyManagedBlock(id, path, artifactText) {
  if (!existsSync(path)) return check(id, false, `${path} missing`);
  const block = extractBlockFromArtifact(artifactText);
  const parsed = parseManagedBlock(readFileSync(path, "utf8"));
  if (!parsed.present) return check(id, false, "file exists without a Prumo managed block (foreign)");
  if (!parsed.valid) return { ...check(id, false, "managed block edited outside Prumo"), drift: true };
  if (parsed.declaredHash !== block.hash) return check(id, "warn", `managed block carries protocol ${parsed.version}, installed protocol differs`);
  return check(id, true, `managed block protocol ${parsed.version}`);
}

export function artifactFiles(artifacts, prefix) {
  return [...artifacts.entries()].filter(([name]) => name.startsWith(prefix)).map(([name, content]) => ({ relative: name.slice(prefix.length), content }));
}

export function ownedFiles(journal, adapter, underDirectory, fallbackArtifacts = []) {
  const prefix = underDirectory.replaceAll("\\", "/").replace(/\/$/, "");
  const lowered = prefix.toLowerCase();
  const entries = (journal?.targets?.[adapter]?.mutations ?? [])
    .filter(entry => entry.ownership === OWNERSHIP.FILE && entry.path.replaceAll("\\", "/").toLowerCase().startsWith(`${lowered}/`))
    .map(entry => ({ path: entry.path, afterHash: entry.afterHash, relative: entry.path.replaceAll("\\", "/").slice(prefix.length + 1) }));
  const seen = new Set(entries.map(entry => entry.relative.toLowerCase()));
  for (const artifact of fallbackArtifacts) {
    if (seen.has(artifact.relative.toLowerCase())) continue;
    entries.push({ path: `${underDirectory}/${artifact.relative}`.replaceAll("/", process.platform === "win32" ? "\\" : "/"), afterHash: hashText(artifact.content), relative: artifact.relative });
  }
  return entries;
}

function isEmptyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

export function readConfigObject(path) {
  if (!existsSync(path)) return { exists: false, value: undefined };
  const text = readFileSync(path, "utf8");
  try {
    return { exists: true, value: readJsoncObject(text), text };
  } catch (error) {
    return { exists: true, error: error instanceof Error ? error.message : String(error), text };
  }
}

export function check(id, ok, detail, { level } = {}) {
  return { id, status: ok === true ? "PASS" : ok === "warn" ? "WARN" : "FAIL", detail, level: level ?? (ok === true ? "pass" : ok === "warn" ? "warn" : "fail") };
}

export function summarizeState(checks, { requiredIds, optionalIds = [] }) {
  const required = checks.filter(entry => requiredIds.includes(entry.id));
  const requiredFail = required.filter(entry => entry.status === "FAIL");
  const anyPass = checks.some(entry => entry.status === "PASS");
  if (checks.some(entry => entry.status === "FAIL" && entry.broken)) return "BROKEN";
  if (required.length > 0 && requiredFail.length === required.length && !anyPass) return "ABSENT";
  if (checks.some(entry => entry.drift)) return "DRIFTED";
  if (requiredFail.length > 0) return "PARTIAL";
  if (optionalIds.some(id => checks.find(entry => entry.id === id)?.status === "FAIL")) return "PARTIAL";
  return "ACTIVE";
}

export function verifyGroupedHook(context, { id, path, eventPath, cli }) {
  const config = readConfigObject(path);
  if (!config.exists) return check(id, false, `${path} missing`);
  if (config.error) return { ...check(id, false, `${path} does not parse: ${config.error}`), broken: true };
  const groups = eventPath.reduce((node, key) => node?.[key], config.value);
  const hook = Array.isArray(groups) ? groups.flatMap(group => group?.hooks ?? []).find(entry => isPrumoCommand(entry?.command)) : undefined;
  return verifyHookEntry(context, id, hook, cli);
}

export function verifyFlatHook(context, { id, path, eventPath, cli }) {
  const config = readConfigObject(path);
  if (!config.exists) return check(id, false, `${path} missing`);
  if (config.error) return { ...check(id, false, `${path} does not parse: ${config.error}`), broken: true };
  const items = eventPath.reduce((node, key) => node?.[key], config.value);
  const hook = Array.isArray(items) ? items.find(entry => isPrumoCommand(entry?.command)) : undefined;
  return verifyHookEntry(context, id, hook, cli);
}

function verifyHookEntry(context, id, hook, cli) {
  if (!hook) return check(id, false, "no Prumo hook registered");
  if (!commandTargets(hook.command, context.layout.hookPath)) return { ...check(id, false, `hook command does not resolve to ${context.layout.hookPath}`), drift: true };
  if (!splitCommand(hook.command).includes(`--cli=${cli}`)) return { ...check(id, false, `hook command missing --cli=${cli}`), drift: true };
  if (!existsSync(context.layout.hookPath)) return { ...check(id, false, `runtime hook missing at ${context.layout.hookPath}`), broken: true };
  return check(id, true, "reachable");
}

export function verifyOwnedFile(id, path, expectedContent) {
  if (!existsSync(path)) return check(id, false, `${path} missing`);
  const current = readFileSync(path, "utf8");
  if (expectedContent !== undefined && hashText(current) !== hashText(expectedContent)) return { ...check(id, false, `${path} differs from the compiled artifact`), drift: true };
  return check(id, true, "current");
}

export function verifyTomlValue(id, path, section, key, expected) {
  if (!existsSync(path)) return check(id, false, `${path} missing`);
  const value = readTomlValue(readFileSync(path, "utf8"), section, key);
  if (value === undefined) return check(id, false, `[${section}] ${key} not set`);
  if (expected !== undefined && value !== expected) return check(id, "warn", `[${section}] ${key} = ${value}`);
  return check(id, true, `[${section}] ${key} = ${value}`);
}
