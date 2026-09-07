#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFromRepository, updateReadmeBlock } from "@prumocode/compiler";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes("--check");
const compiled = compileFromRepository(root);
const errors = compiled.findings.filter(finding => finding.severity === "error");
for (const finding of compiled.findings) console.error(`${finding.severity.toUpperCase().padEnd(7)} ${finding.code.padEnd(24)} ${finding.message}`);
if (errors.length > 0) {
  console.error(`\nbuild refused: ${errors.length} protocol integrity error(s)`);
  process.exit(3);
}

const generatedDir = join(root, "generated");
const expected = new Set(compiled.files.keys());
let written = 0;
let stale = 0;

for (const [name, content] of compiled.files) {
  const path = join(generatedDir, ...name.split("/"));
  const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (current === content) continue;
  stale += 1;
  if (check) continue;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  written += 1;
}
for (const orphan of listFiles(generatedDir)) {
  if (expected.has(orphan)) continue;
  stale += 1;
  if (!check) rmSync(join(generatedDir, ...orphan.split("/")));
}

const readmePath = join(root, "README.md");
const readme = readFileSync(readmePath, "utf8");
const nextReadme = updateReadmeBlock(readme, compiled.files.get("readme-block.md"));
if (nextReadme !== readme) {
  stale += 1;
  if (!check) writeFileSync(readmePath, nextReadme);
}

const bridgePath = join(root, "AGENTS.md");
const bridge = compiled.files.get("agents/AGENTS.md");
if (!existsSync(bridgePath) || readFileSync(bridgePath, "utf8") !== bridge) {
  stale += 1;
  if (!check) writeFileSync(bridgePath, bridge);
}

if (check) {
  if (stale > 0) {
    console.error(`${stale} generated artifact(s) stale; run npm run build`);
    process.exit(4);
  }
  console.log(`generated artifacts fresh: protocol ${compiled.protocolVersion}, ${compiled.manifest.ruleCount} rules, kernel ${compiled.manifest.kernel.tokens} tokens`);
} else {
  console.log(`protocol ${compiled.protocolVersion}: ${compiled.manifest.ruleCount} rules (${compiled.manifest.ruleRange.first} to ${compiled.manifest.ruleRange.last}), kernel ${compiled.manifest.kernel.tokens} tokens, ${compiled.files.size} artifacts, ${written} written`);
}

function listFiles(directory, prefix = "") {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const name = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(path).isDirectory()) files.push(...listFiles(path, name));
    else files.push(name);
  }
  return files;
}
