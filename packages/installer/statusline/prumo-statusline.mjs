#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, parse as parsePath } from "node:path";

const PROTOCOL_FILES = ["CLAUDE.md", "AGENTS.md", join(".claude", "CLAUDE.md"), join(".cursor", "AGENTS.md"), join(".codex", "AGENTS.md"), join(".grok", "AGENTS.md")];
const MAX_WALK_DEPTH = 12;
const PROTOCOL_MARKER = "PRU-01";
const STDIN_TIMEOUT_MS = 400;
const STDIN_LIMIT = 1_000_000;

main();

async function main() {
  try {
    if (process.argv.includes("--preview")) {
      process.stdout.write(render({ workspace: { current_dir: process.cwd() }, model: { display_name: "Opus 5" } }) + "\n");
      return;
    }
    const session = parseJson(await readStdin());
    const line = render(session);
    if (line) process.stdout.write(line);
  } catch {
    process.exitCode = 0;
  }
}

function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
      resolve(value);
    };
    const timer = setTimeout(() => finish(data), STDIN_TIMEOUT_MS);
    const onData = chunk => {
      data += chunk;
      if (data.length > STDIN_LIMIT) finish(data.slice(0, STDIN_LIMIT));
    };
    const onEnd = () => finish(data);
    const onError = () => finish("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
  });
}

function parseJson(payload) {
  if (!payload) return {};
  try {
    const value = JSON.parse(payload);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function render(session) {
  const palette = createPalette();
  const directory = firstString(session.workspace?.current_dir, session.workspace?.project_dir, session.cwd, session.workspaceRoot, session.workspace_roots?.[0]) ?? process.cwd();
  const model = firstString(session.model?.display_name, session.model?.id, session.model) ?? "unknown model";
  const project = basename(directory) || directory;
  const separator = palette.divider(" | ");
  const body = palette.model(model) + separator + palette.project(project);
  if (!hasProtocol(directory)) return body;
  return palette.label("Workstate:") + " " + palette.badge(" Prumo ") + separator + body;
}

function hasProtocol(directory) {
  let current = directory;
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth += 1) {
    for (const candidate of PROTOCOL_FILES) {
      const path = join(current, candidate);
      if (existsSync(path) && declaresProtocol(path)) return true;
    }
    const parent = dirname(current);
    if (parent === current || parent === parsePath(current).root) return false;
    current = parent;
  }
  return false;
}

function declaresProtocol(path) {
  try {
    return readFileSync(path, "utf8").includes(PROTOCOL_MARKER);
  } catch {
    return false;
  }
}

function createPalette() {
  const env = process.env;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") {
    const plain = value => value;
    return { label: plain, badge: value => `[${value.trim()}]`, model: plain, project: plain, divider: plain };
  }
  const truecolor = /truecolor|24bit/i.test(env.COLORTERM ?? "") || env.WT_SESSION !== undefined || env.TERM_PROGRAM === "vscode";
  const reset = "\u001b[0m";
  const foreground = truecolor ? (r, g, b) => `\u001b[38;2;${r};${g};${b}m` : (_r, _g, _b, code) => `\u001b[38;5;${code}m`;
  const background = truecolor ? (r, g, b) => `\u001b[48;2;${r};${g};${b}m` : (_r, _g, _b, code) => `\u001b[48;5;${code}m`;
  const paint = (color, value) => `${color}${value}${reset}`;
  return {
    label: value => paint(foreground(88, 121, 157, 67), value),
    badge: value => `${background(19, 31, 47, 17)}${foreground(170, 226, 248, 195)}\u001b[1m${value}${reset}`,
    model: value => paint(foreground(131, 183, 226, 110), value),
    project: value => paint(foreground(126, 205, 241, 117), value),
    divider: value => paint(foreground(58, 86, 122, 60), value)
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}
