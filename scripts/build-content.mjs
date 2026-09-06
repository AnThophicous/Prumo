#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const contentDir = join(root, "content");
const source = readFileSync(join(contentDir, "PRUMO.md"), "utf8");

const VARIANTS = [
  {
    file: "CLAUDE.md",
    consumers: "Claude Code (project root and ~/.claude/CLAUDE.md)"
  },
  {
    file: "AGENTS.md",
    consumers: "Codex CLI, Cursor (CLI and app), Grok Build, and every other agent that reads AGENTS.md"
  },
  {
    file: "GEMINI.md",
    consumers: "Gemini CLI"
  }
];

const header = variant => `<!-- Prumo protocol — generated from content/PRUMO.md. Do not edit this copy. -->
<!-- Read by: ${variant.consumers} -->

`;

mkdirSync(contentDir, { recursive: true });
for (const variant of VARIANTS) {
  writeFileSync(join(contentDir, variant.file), header(variant) + source);
  process.stdout.write(`wrote content/${variant.file}\n`);
}
