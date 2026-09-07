import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function hashText(text) {
  return createHash("sha256").update(String(text).replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

export function hashFile(path) {
  if (!existsSync(path)) return undefined;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function readText(path, fallback = "") {
  if (!existsSync(path)) return fallback;
  return readFileSync(path, "utf8");
}

export function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

export function writeTextAtomic(path, content) {
  ensureDirectory(dirname(path));
  const temporary = `${path}.prumo-tmp-${process.pid}`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

export function removeFile(path) {
  rmSync(path, { force: true });
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
    if (!filter(entry, from)) continue;
    copyFileSync(from, to);
  }
}

export function listFiles(directory, prefix = "") {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(path).isDirectory()) files.push(...listFiles(path, relative));
    else files.push(relative);
  }
  return files.sort();
}

export function nodeCommand(scriptPath, argumentsList = [], platform = process.platform) {
  const parts = ["node", scriptPath, ...argumentsList].map(part => quoteArgument(String(part), platform));
  return parts.join(" ");
}

export function quoteArgument(value, platform = process.platform) {
  if (platform === "win32") {
    const text = value.replaceAll("\\", "/");
    return /[\s"'`$&|<>^]/.test(text) || text.length === 0 ? `"${text.replaceAll('"', '\\"')}"` : text;
  }
  if (/^[A-Za-z0-9_\-=./:+@,]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function splitCommand(command) {
  const words = [];
  let current = "";
  let quote;
  let hasWord = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      if (character === quote) {
        quote = undefined;
        continue;
      }
      if (quote === '"' && character === "\\" && command[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      current += character;
      continue;
    }
    if (character === "\\" && index + 1 < command.length) {
      current += command[index + 1];
      index += 1;
      hasWord = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      hasWord = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (hasWord || current.length > 0) words.push(current);
      current = "";
      hasWord = false;
      continue;
    }
    current += character;
    hasWord = true;
  }
  if (hasWord || current.length > 0) words.push(current);
  return words;
}
