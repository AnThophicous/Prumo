import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CHAPTERS, EVAL_SUITES } from "./chapters.mjs";
import { sha256 } from "./hash.mjs";
import { lintProtocol, KNOWN_CONFLICTS } from "./lint.mjs";
import { parseProtocol, ruleMarkdown, ruleText, kernelText, stripMarkers, compareRuleIds } from "./parse.mjs";
import {
  AGENT_VARIANTS,
  KERNEL_TOKEN_BUDGET,
  MANAGED_BEGIN,
  MANAGED_END,
  README_BEGIN,
  README_END,
  buildManifest,
  managedBlock,
  renderAgentBridge,
  renderChapter,
  renderCoverageReport,
  renderFullProtocol,
  renderKernel,
  renderKernelBody,
  renderMapSourceSchemaDoc,
  renderMapSourceTemplate,
  renderReadmeBlock,
  renderReminder,
  renderSkill,
  stamp
} from "./render.mjs";
import { estimateTokens, TOKEN_ESTIMATE_NOTE } from "./tokens.mjs";

export {
  AGENT_VARIANTS,
  CHAPTERS,
  EVAL_SUITES,
  KERNEL_TOKEN_BUDGET,
  KNOWN_CONFLICTS,
  MANAGED_BEGIN,
  MANAGED_END,
  README_BEGIN,
  README_END,
  TOKEN_ESTIMATE_NOTE,
  compareRuleIds,
  estimateTokens,
  kernelText,
  lintProtocol,
  managedBlock,
  parseProtocol,
  renderReadmeBlock,
  ruleMarkdown,
  ruleText,
  sha256,
  stamp,
  stripMarkers
};

export const DEFAULT_TARGETS = ["claude", "codex", "cursor", "grok", "gemini"];

export function compileProtocol(source, { targets = DEFAULT_TARGETS, registry, migrationsText } = {}) {
  const ast = parseProtocol(source);
  const protocolVersion = ast.version ?? "0.0.0";
  const sourceHash = sha256(source);
  const kernelBody = renderKernelBody(ast, protocolVersion);
  const reminder = renderReminder(ast, protocolVersion);
  const manifest = buildManifest(ast, { protocolVersion, sourceHash, kernelBody, reminder, targets });
  const findings = lintProtocol(ast, { registry, migrationsText, kernelTokens: manifest.kernel.tokens });
  const files = new Map();
  files.set("protocol.manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  files.set("rule-index.json", `${JSON.stringify(ruleIndex(manifest), null, 2)}\n`);
  files.set("reminder.txt", `${reminder}\n`);
  files.set("kernel/PRUMO-KERNEL.md", renderKernel(ast, protocolVersion, sourceHash));
  files.set("full/PRUMO.md", renderFullProtocol(ast, protocolVersion, sourceHash));
  for (const chapter of CHAPTERS) files.set(`chapters/${chapter.id}.md`, renderChapter(ast, chapter, protocolVersion, sourceHash));
  for (const variant of AGENT_VARIANTS) files.set(`agents/${variant.file}`, renderAgentBridge(ast, protocolVersion, sourceHash, variant));
  files.set("skills/claude/SKILL.md", renderSkill(ast, protocolVersion, sourceHash));
  for (const chapter of CHAPTERS) files.set(`skills/claude/references/${chapter.id}.md`, files.get(`chapters/${chapter.id}.md`));
  files.set("skills/claude/schemas/mapsource.md", `${stamp(protocolVersion, sourceHash)}\n${renderMapSourceSchemaDoc(protocolVersion)}`);
  files.set("templates/MapSource.md", renderMapSourceTemplate(protocolVersion));
  files.set("coverage.md", renderCoverageReport(manifest));
  files.set("readme-block.md", `${renderReadmeBlock(manifest)}\n`);
  return { ast, manifest, files, findings, protocolVersion, sourceHash, kernelBody, reminder };
}

function ruleIndex(manifest) {
  const index = {};
  for (const rule of manifest.rules) {
    index[rule.id] = { section: rule.section, chapter: rule.chapter, title: rule.title, line: rule.source.line, tier: rule.tier, enforcement: rule.enforcement, critical: rule.critical };
  }
  return { protocolVersion: manifest.protocolVersion, sourceHash: manifest.sourceHash, rules: index };
}

export function loadRegistry(protocolDirectory) {
  const registryPath = join(protocolDirectory, "registry.json");
  const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : undefined;
  const migrationsDirectory = join(protocolDirectory, "migrations");
  const migrationsText = {};
  if (existsSync(migrationsDirectory)) {
    for (const entry of readdirSync(migrationsDirectory)) {
      if (!entry.endsWith(".md")) continue;
      migrationsText[entry.replace(/\.md$/, "")] = readFileSync(join(migrationsDirectory, entry), "utf8");
    }
  }
  return { registry, migrationsText };
}

export function compileFromRepository(root, options = {}) {
  const source = readFileSync(join(root, "content", "PRUMO.md"), "utf8");
  const { registry, migrationsText } = loadRegistry(join(root, "protocol"));
  return compileProtocol(source, { registry, migrationsText, ...options });
}

export function explainRule(manifest, ruleId, ast) {
  const rule = manifest.rules.find(entry => entry.id === ruleId.toUpperCase());
  if (!rule) return undefined;
  const related = new Set(rule.references);
  for (const other of manifest.rules) {
    if (other.id === rule.id) continue;
    if (other.references.includes(rule.id)) related.add(other.id);
    if (rule.evalSuite && other.evalSuite === rule.evalSuite) related.add(other.id);
  }
  const parsed = ast?.rules.find(entry => entry.id === rule.id);
  return {
    ...rule,
    text: parsed ? ruleText(parsed) : undefined,
    related: [...related].sort(compareRuleIds)
  };
}

export function updateReadmeBlock(readme, block) {
  const start = readme.indexOf(README_BEGIN);
  const end = readme.indexOf(README_END);
  if (start === -1 || end === -1 || end < start) throw new Error(`README.md has no ${README_BEGIN} ... ${README_END} managed block`);
  return `${readme.slice(0, start)}${block.trimEnd()}${readme.slice(end + README_END.length)}`;
}

export function readmeBlockIsCurrent(readme, block) {
  const start = readme.indexOf(README_BEGIN);
  const end = readme.indexOf(README_END);
  if (start === -1 || end === -1) return false;
  return readme.slice(start, end + README_END.length) === block.trimEnd();
}
