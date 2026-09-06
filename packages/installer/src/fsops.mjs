import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function stripJsonComments(source) {
  let output = "";
  let index = 0;
  let inString = false;
  let inLine = false;
  let inBlock = false;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1] ?? "";
    if (inLine) {
      if (character === "\n") {
        inLine = false;
        output += character;
      }
      index += 1;
      continue;
    }
    if (inBlock) {
      if (character === "*" && next === "/") {
        inBlock = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (inString) {
      output += character;
      if (character === "\\" && index + 1 < source.length) {
        output += source[index + 1];
        index += 2;
        continue;
      }
      if (character === '"') inString = false;
      index += 1;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      index += 1;
      continue;
    }
    if (character === "/" && next === "/") {
      inLine = true;
      index += 2;
      continue;
    }
    if (character === "/" && next === "*") {
      inBlock = true;
      index += 2;
      continue;
    }
    output += character;
    index += 1;
  }
  return removeTrailingCommas(output);
}

function removeTrailingCommas(source) {
  let output = "";
  let inString = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && inString && index + 1 < source.length) {
      output += character + source[index + 1];
      index += 1;
      continue;
    }
    if (character === '"') inString = !inString;
    if (character === "," && !inString) {
      let lookahead = index + 1;
      while (/\s/.test(source[lookahead] ?? "")) lookahead += 1;
      if (source[lookahead] === "}" || source[lookahead] === "]") continue;
    }
    output += character;
  }
  return output;
}

export function readJson(path, fallback = {}) {
  if (!existsSync(path)) return structuredClone(fallback);
  try {
    const parsed = JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected a JSON object");
    return parsed;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot parse ${path}: ${detail}`);
  }
}

export function writeJson(path, value) {
  ensureDirectory(dirname(path));
  backup(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(path, content) {
  ensureDirectory(dirname(path));
  backup(path);
  writeFileSync(path, content);
}

export function copyInto(source, target) {
  ensureDirectory(dirname(target));
  backup(target);
  copyFileSync(source, target);
}

export function copyDirectory(source, target, filter = () => true) {
  ensureDirectory(target);
  for (const entry of readdirSync(source)) {
    const from = join(source, entry);
    const to = join(target, entry);
    if (statSync(from).isDirectory()) {
      copyDirectory(from, to, filter);
      continue;
    }
    if (!filter(entry)) continue;
    copyFileSync(from, to);
  }
}

export function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

export function backup(path) {
  if (!existsSync(path)) return undefined;
  const target = `${path}.prumo-backup`;
  if (existsSync(target)) return target;
  copyFileSync(path, target);
  return target;
}

export function upsertTomlValue(source, section, key, literal) {
  const lines = source.split(/\r?\n/);
  const header = `[${section}]`;
  const assignment = `${key} = ${literal}`;
  const sectionIndex = lines.findIndex(line => line.trim() === header);
  if (sectionIndex === -1) {
    const prefix = source.trim().length === 0 ? "" : `${source.replace(/\s*$/, "")}\n\n`;
    return `${prefix}${header}\n${assignment}\n`;
  }
  let end = lines.length;
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      end = index;
      break;
    }
  }
  const keyIndex = lines.slice(sectionIndex + 1, end).findIndex(line => new RegExp(`^\\s*${key}\\s*=`).test(line));
  if (keyIndex === -1) {
    lines.splice(end, 0, assignment);
  } else {
    lines[sectionIndex + 1 + keyIndex] = assignment;
  }
  return lines.join("\n");
}

export function readText(path, fallback = "") {
  if (!existsSync(path)) return fallback;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fallback;
  }
}

export function nodeCommand(scriptPath, argumentsList = []) {
  const commandPath = commandArgument(scriptPath);
  const argumentsText = argumentsList.map(commandArgument).join(" ");
  return argumentsText.length > 0 ? `node ${commandPath} ${argumentsText}` : `node ${commandPath}`;
}

function commandArgument(value) {
  const text = String(value);
  if (process.platform === "win32") return `"${text.replaceAll("\\", "/").replaceAll('"', '\\"')}"`;
  return `'${text.replaceAll("'", `'"'"'`)}'`;
}
