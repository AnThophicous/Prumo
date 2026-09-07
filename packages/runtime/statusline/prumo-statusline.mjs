#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, parse as parsePath } from "node:path";
import { pathToFileURL } from "node:url";
import { readProjectState } from "../src/project-state.mjs";
import { readBoundedStdin } from "../src/stdin.mjs";

const BRIDGE_FILES = ["CLAUDE.md", "AGENTS.md", "GEMINI.md"];
const MAX_WALK_DEPTH = 12;
const MANAGED_MARKER = "<!-- PRUMO:BEGIN";
const STDIN_TIMEOUT_MS = 400;
const STDIN_LIMIT = 1_000_000;

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();

async function main() {
  try {
    if (process.argv.includes("--preview")) {
      process.stdout.write(`${render({ workspace: { current_dir: process.cwd() }, model: { display_name: "Opus 5" } })}\n`);
      return;
    }
    const session = parseJson(await readBoundedStdin({ timeoutMs: STDIN_TIMEOUT_MS, limitBytes: STDIN_LIMIT }));
    const line = render(session);
    if (line) process.stdout.write(line);
  } catch (error) {
    if (process.env.PRUMO_DEBUG === "1") process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 0;
  }
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

export function render(session, { env = process.env } = {}) {
  const palette = createPalette(env);
  const directory = firstString(session.workspace?.current_dir, session.workspace?.project_dir, session.cwd, session.workspaceRoot, session.workspace_roots?.[0]) ?? process.cwd();
  const model = firstString(session.model?.display_name, session.model?.id, session.model) ?? "unknown model";
  const project = basename(directory) || directory;
  const separator = palette.divider(" | ");
  const body = palette.model(model) + separator + palette.project(project);
  const state = protocolState(directory, env);
  if (!state) return body;
  const badge = state === "ACTIVE" ? " Prumo " : ` Prumo:${state.toLowerCase()} `;
  return `${palette.label("Workstate:")} ${palette.badge(badge)}${separator}${body}`;
}

function protocolState(directory, env) {
  const cached = readProjectState(directory, env);
  if (cached && typeof cached.bridge === "string") return cached.bridge === "ABSENT" ? undefined : cached.bridge;
  return scanForBridge(directory) ? "ACTIVE" : undefined;
}

function scanForBridge(directory) {
  let current = directory;
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth += 1) {
    for (const candidate of BRIDGE_FILES) {
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
    return readFileSync(path, "utf8").includes(MANAGED_MARKER);
  } catch {
    return false;
  }
}

function createPalette(env) {
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
