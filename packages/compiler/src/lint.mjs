import { CHAPTERS, EVAL_SUITES } from "./chapters.mjs";
import { compareRuleIds } from "./parse.mjs";
import { KERNEL_TOKEN_BUDGET, routerChapterIds } from "./render.mjs";

export const KNOWN_CONFLICTS = [
  {
    id: "comments",
    description: "PRU-20 forbids comments while PRU-177 and PRU-182 allow some; PRU-20, PRU-91 and PRU-150 must name the exceptions",
    requirements: [
      { rule: "PRU-20", mustReference: ["PRU-177", "PRU-182"] },
      { rule: "PRU-150", mustReference: ["PRU-177", "PRU-182"] },
      { rule: "PRU-91", mustReference: ["PRU-177", "PRU-182"] }
    ]
  },
  {
    id: "user-decision-vs-verdict",
    description: "PRU-35 executes the user's decision while PRU-156 keeps the verdict; PRU-35 must point at Section 15 and PRU-159 must point at PRU-35",
    requirements: [
      { rule: "PRU-35", mustMention: ["Section 15"] },
      { rule: "PRU-159", mustReference: ["PRU-35"] }
    ]
  },
  {
    id: "iteration-limit-vs-debugging",
    description: "PRU-16 stops after three runs while Section 19 says how to iterate; PRU-16 must point at Section 19",
    requirements: [{ rule: "PRU-16", mustMention: ["Section 19"] }]
  }
];

export function lintProtocol(ast, { registry, migrationsText = {}, kernelTokens } = {}) {
  const findings = [];
  const fail = (code, message, extra = {}) => findings.push({ severity: "error", code, message, ...extra });
  const warn = (code, message, extra = {}) => findings.push({ severity: "warning", code, message, ...extra });
  const ids = ast.rules.map(rule => rule.id);
  const idSet = new Set(ids);

  if (!ast.version) fail("version-missing", "content/PRUMO.md has no <!-- prumo-protocol: version=x.y.z --> marker");
  for (const problem of ast.problems) fail(problem.code, problem.message, { rule: problem.rule });

  const seen = new Set();
  for (const rule of ast.rules) {
    if (seen.has(rule.id)) fail("duplicate-id", `${rule.id} is declared more than once (line ${rule.line})`, { rule: rule.id });
    seen.add(rule.id);
  }

  for (let index = 1; index < ast.rules.length; index += 1) {
    const previous = ast.rules[index - 1];
    const rule = ast.rules[index];
    if (compareRuleIds(previous.id, rule.id) > 0) fail("rule-order", `${rule.id} (line ${rule.line}) is out of order after ${previous.id}`, { rule: rule.id });
  }

  for (const rule of ast.rules) {
    for (const reference of rule.references) {
      if (!idSet.has(reference)) fail("unresolved-reference", `${rule.id} references ${reference}, which does not exist`, { rule: rule.id });
    }
  }

  const sectionNumbers = ast.sections.filter(section => section.number !== undefined).map(section => section.number);
  for (let index = 1; index < sectionNumbers.length; index += 1) {
    if (sectionNumbers[index] <= sectionNumbers[index - 1]) fail("section-order", `Section ${sectionNumbers[index]} appears after Section ${sectionNumbers[index - 1]}`);
  }
  for (const entry of ast.contents) {
    const present = ast.sections.some(section => (entry.number !== undefined ? section.number === entry.number : section.appendix === entry.appendix));
    if (!present) fail("index-orphan", `The index lists ${entry.number !== undefined ? `Section ${entry.number}` : `Appendix ${entry.appendix}`} but no such heading exists`);
  }
  for (const section of ast.sections) {
    const listed = ast.contents.some(entry => (section.number !== undefined ? entry.number === section.number : entry.appendix === section.appendix));
    if (!listed) fail("index-missing", `${section.number !== undefined ? `Section ${section.number}` : `Appendix ${section.appendix}`} — ${section.title} is not in the index`);
    const indexed = ast.contents.find(entry => (section.number !== undefined ? entry.number === section.number : entry.appendix === section.appendix));
    if (indexed && indexed.title !== section.title) fail("index-title", `Index title "${indexed.title}" differs from heading "${section.title}"`);
  }

  for (const section of ast.sections) {
    if (section.number === undefined || section.ruleIds.length === 0) continue;
    if (!CHAPTERS.some(chapter => chapter.sections.includes(section.number))) fail("section-unmapped", `Section ${section.number} has rules but belongs to no chapter`);
  }
  const mappedSections = new Set(CHAPTERS.flatMap(chapter => chapter.sections));
  for (const number of mappedSections) {
    if (!ast.sections.some(section => section.number === number)) fail("chapter-orphan", `A chapter maps Section ${number}, which does not exist`);
  }
  const routed = routerChapterIds(ast);
  for (const id of routed) {
    if (!CHAPTERS.some(chapter => chapter.id === id)) fail("router-unknown-chapter", `The Section 0 router names chapter "${id}", which is not compiled`);
  }
  for (const chapter of CHAPTERS) {
    if (!routed.includes(chapter.id)) fail("router-missing-chapter", `Chapter "${chapter.id}" is compiled but the Section 0 router never loads it`);
    if (chapter.triggers.length === 0) fail("chapter-without-trigger", `Chapter "${chapter.id}" has no trigger`);
  }

  for (const rule of ast.rules) {
    if (rule.critical && (rule.enforcement === "MANUAL" || rule.enforcement === "DOCUMENTARY")) {
      fail("critical-without-eval", `${rule.id} is critical but classified ${rule.enforcement}; a critical rule needs a test or an eval (PRU-264)`, { rule: rule.id });
    }
    if (rule.enforcement === "BEHAVIOR_EVAL" && !rule.evalSuite) fail("eval-suite-missing", `${rule.id} is BEHAVIOR_EVAL but names no eval suite`, { rule: rule.id });
    if (rule.evalSuite && !EVAL_SUITES.includes(rule.evalSuite)) fail("eval-suite-unknown", `${rule.id} names unknown eval suite "${rule.evalSuite}"`, { rule: rule.id });
  }

  for (const conflict of KNOWN_CONFLICTS) {
    for (const requirement of conflict.requirements) {
      const rule = ast.rules.find(entry => entry.id === requirement.rule);
      if (!rule) {
        fail("contradiction-unresolved", `${conflict.id}: ${requirement.rule} is missing, so the conflict cannot be resolved`);
        continue;
      }
      const text = [rule.firstLine, ...rule.bodyLines].join("\n");
      for (const reference of requirement.mustReference ?? []) {
        if (!rule.references.includes(reference)) fail("contradiction-unresolved", `${conflict.id}: ${requirement.rule} must reference ${reference} (${conflict.description})`, { rule: rule.id });
      }
      for (const mention of requirement.mustMention ?? []) {
        if (!text.includes(mention)) fail("contradiction-unresolved", `${conflict.id}: ${requirement.rule} must mention "${mention}" (${conflict.description})`, { rule: rule.id });
      }
    }
  }

  if (typeof kernelTokens === "number" && kernelTokens > KERNEL_TOKEN_BUDGET) fail("kernel-budget", `Kernel estimated at ${kernelTokens} tokens, over the ${KERNEL_TOKEN_BUDGET} budget`);

  if (registry) lintRegistry(ast, registry, migrationsText, fail, warn);

  return findings;
}

function lintRegistry(ast, registry, migrationsText, fail, warn) {
  const registered = registry.rules ?? {};
  for (const rule of ast.rules) {
    const entry = registered[rule.id];
    if (!entry) {
      fail("registry-missing", `${rule.id} exists in the protocol but not in protocol/registry.json; register it with the version that introduced it`, { rule: rule.id });
      continue;
    }
    if (entry.removed) fail("registry-removed-present", `${rule.id} is marked removed in ${entry.removed} but still exists in the protocol`, { rule: rule.id });
    if (entry.changed && !migrationMentions(migrationsText, entry.changed, rule.id)) {
      fail("migration-missing", `${rule.id} changed in ${entry.changed} but protocol/migrations/${entry.changed}.md does not document it`, { rule: rule.id });
    }
  }
  const present = new Set(ast.rules.map(rule => rule.id));
  for (const [id, entry] of Object.entries(registered)) {
    if (present.has(id)) continue;
    if (!entry.removed) {
      fail("rule-removed", `${id} is registered but missing from the protocol; a removal requires a migration entry`, { rule: id });
      continue;
    }
    if (!migrationMentions(migrationsText, entry.removed, id)) fail("migration-missing", `${id} was removed in ${entry.removed} but protocol/migrations/${entry.removed}.md does not document it`, { rule: id });
  }
  if (registry.protocolVersion && ast.version && registry.protocolVersion !== ast.version) {
    warn("registry-version", `protocol/registry.json says ${registry.protocolVersion}; content/PRUMO.md says ${ast.version}`);
  }
}

function migrationMentions(migrationsText, version, ruleId) {
  const text = migrationsText[version];
  return typeof text === "string" && text.includes(ruleId);
}
