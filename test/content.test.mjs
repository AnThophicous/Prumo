import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contentDirectory = join(root, "content");
const source = readFileSync(join(contentDirectory, "PRUMO.md"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");
const variants = [
  ["CLAUDE.md", "Claude Code (project root and ~/.claude/CLAUDE.md)"],
  ["AGENTS.md", "Codex CLI, Cursor (CLI and app), Grok Build, and every other agent that reads AGENTS.md"],
  ["GEMINI.md", "Gemini CLI"]
];

test("agent protocol variants match the normative source", () => {
  for (const [file, consumers] of variants) {
    const header = `<!-- Prumo protocol — generated from content/PRUMO.md. Do not edit this copy. -->\n<!-- Read by: ${consumers} -->\n\n`;
    assert.equal(readFileSync(join(contentDirectory, file), "utf8"), header + source, file);
  }
});

test("README contains no assistant authorship attribution", () => {
  assert.doesNotMatch(readme, /(?:made|written|created|authored|co-?authored)\s+by\s+Claude/i);
});
