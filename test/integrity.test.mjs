import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { KERNEL_TOKEN_BUDGET, compileProtocol, estimateTokens, loadRegistry, parseProtocol, ruleText } from "@prumocode/compiler";
import { lintRepository } from "@prumocode/verifier";
import { ROOT, SOURCE, compiled } from "./helpers.mjs";

const RESTORED = ["PRU-29", "PRU-152", "PRU-153", "PRU-154", "PRU-155", "PRU-156", "PRU-157", "PRU-158", "PRU-159", "PRU-240", "PRU-241", "PRU-242", "PRU-243", "PRU-244", "PRU-245", "PRU-246", "PRU-247"];
const CRITICAL = ["PRU-27", "PRU-33", "PRU-40", "PRU-51", "PRU-115", "PRU-152", "PRU-156", "PRU-158", "PRU-210", "PRU-220", "PRU-223", "PRU-238", "PRU-240", "PRU-245"];

test("canonical protocol has 201 rules including every restored id and Section 20", () => {
  const { manifest } = compiled();
  assert.equal(manifest.ruleCount, 201);
  assert.equal(manifest.ruleRange.first, "PRU-01");
  assert.equal(manifest.ruleRange.last, "PRU-267");
  const ids = new Set(manifest.rules.map(rule => rule.id));
  for (const id of RESTORED) assert.ok(ids.has(id), `${id} missing`);
  for (let index = 250; index <= 267; index += 1) assert.ok(ids.has(`PRU-${index}`), `PRU-${index} missing`);
  assert.ok(manifest.sections.some(section => section.number === 15));
  assert.ok(manifest.sections.some(section => section.number === 19));
  assert.ok(manifest.sections.some(section => section.number === 20));
});

test("repository lint is clean: no errors in protocol, generated artifacts or README", () => {
  const result = lintRepository(ROOT);
  assert.deepEqual(result.errors, []);
});

test("generated artifacts are byte-identical to a fresh compile and stamped with version and hash", () => {
  const { files, protocolVersion, sourceHash } = compiled();
  for (const [name, content] of files) {
    const path = join(ROOT, "generated", ...name.split("/"));
    assert.ok(existsSync(path), `generated/${name} missing`);
    assert.equal(readFileSync(path, "utf8"), content, `generated/${name} differs`);
    if ((name.endsWith(".md") || name.endsWith(".mdc")) && name !== "coverage.md" && name !== "readme-block.md") {
      assert.ok(content.includes(`Protocol ${protocolVersion}`) || content.includes(`protocol=${protocolVersion}`) || content.includes(`prumo_protocol: ${protocolVersion}`), `${name} lacks a version stamp`);
      if (!name.startsWith("templates/") && name !== "coverage.md" && name !== "readme-block.md") assert.ok(content.includes(sourceHash) || content.includes("hash="), `${name} lacks a hash stamp`);
    }
  }
});

test("kernel stays within its token budget and contains the router and the critical honesty rules", () => {
  const { manifest, files } = compiled();
  assert.ok(manifest.kernel.tokens <= KERNEL_TOKEN_BUDGET, `kernel ${manifest.kernel.tokens} > ${KERNEL_TOKEN_BUDGET}`);
  const kernel = files.get("kernel/PRUMO-KERNEL.md");
  assert.ok(estimateTokens(kernel) <= KERNEL_TOKEN_BUDGET + 200);
  for (const id of ["PRU-40", "PRU-152", "PRU-156", "PRU-158", "PRU-210", "PRU-240"]) assert.ok(manifest.kernel.rules.includes(id), `${id} not in kernel`);
  assert.match(kernel, /## Chapter router/);
  assert.doesNotMatch(kernel, /OWASP/);
});

test("common working set uses at least 60 percent less context than the full protocol", () => {
  const { manifest, files } = compiled();
  const full = estimateTokens(files.get("full/PRUMO.md"));
  const defaults = manifest.chapters.filter(chapter => chapter.defaultLoad).reduce((sum, chapter) => sum + chapter.tokens, 0);
  const working = manifest.kernel.tokens + defaults;
  assert.ok(working <= full * 0.4, `working set ${working} tokens is more than 40% of full ${full}`);
});

test("reminder and skill are compiled: every cited id exists, range comes from the manifest", () => {
  const { manifest, files, reminder } = compiled();
  const ids = new Set(manifest.rules.map(rule => rule.id));
  for (const match of reminder.matchAll(/PRU-\d+/g)) assert.ok(ids.has(match[0]), `reminder cites ${match[0]}`);
  const skill = files.get("skills/claude/SKILL.md");
  assert.ok(skill.includes(`${manifest.ruleRange.first} to ${manifest.ruleRange.last}`));
  assert.doesNotMatch(skill, /PRU-239\b/);
  for (const chapter of manifest.chapters) assert.ok(skill.includes(`references/${chapter.id}.md`), `skill lacks ${chapter.id}`);
});

test("every agent bridge carries the same normative kernel block", () => {
  const { files } = compiled();
  const blocks = ["CLAUDE.md", "AGENTS.md", "GEMINI.md", "grok-rule.md", "cursor-rule.mdc"].map(file => files.get(`agents/${file}`).match(/<!-- PRUMO:BEGIN[\s\S]*<!-- PRUMO:END -->/)[0]);
  for (const block of blocks) assert.equal(block, blocks[0]);
});

test("critical rules are classified and covered by an eval suite or deterministic test", () => {
  const { manifest } = compiled();
  for (const id of CRITICAL) {
    const rule = manifest.rules.find(entry => entry.id === id);
    assert.ok(rule, `${id} missing`);
    assert.ok(rule.critical, `${id} not marked critical`);
    assert.ok(["BEHAVIOR_EVAL", "DETERMINISTICALLY_TESTED", "ENFORCED"].includes(rule.enforcement), `${id} has enforcement ${rule.enforcement}`);
  }
  for (const rule of manifest.rules) assert.ok(rule.enforcement, `${rule.id} unclassified`);
});

test("comment rules are consistent: PRU-20 and PRU-150 defer to PRU-177 and PRU-182", () => {
  const ast = parseProtocol(SOURCE);
  const text = id => ruleText(ast.rules.find(rule => rule.id === id));
  assert.match(text("PRU-20"), /PRU-177/);
  assert.match(text("PRU-20"), /PRU-182/);
  assert.match(text("PRU-150"), /PRU-177\/182|PRU-177 and PRU-182/);
  assert.match(text("PRU-151"), /PRU-157/);
});

function mutate(replacer) {
  const { registry, migrationsText } = loadRegistry(join(ROOT, "protocol"));
  const mutated = replacer(SOURCE);
  assert.ok(mutated !== SOURCE, "mutation did not change the source");
  return compileProtocol(mutated, { registry, migrationsText }).findings.filter(finding => finding.severity === "error");
}

test("mutation: removing PRU-158 fails lint as a missing rule", () => {
  const errors = mutate(source => source.replace(/\*\*PRU-158\.[^\n]*\n/, ""));
  assert.ok(errors.some(finding => /PRU-158/.test(finding.message) && /(removed|missing|registry|unresolved)/i.test(finding.message)), JSON.stringify(errors));
});

test("mutation: duplicating PRU-240 fails lint as a duplicate id", () => {
  const errors = mutate(source => source.replace(/\*\*PRU-241\./, "**PRU-240."));
  assert.ok(errors.some(finding => finding.code === "duplicate-id" && /PRU-240/.test(finding.message)), JSON.stringify(errors));
});

test("mutation: a reference to PRU-999 fails lint as unresolved", () => {
  const errors = mutate(source => source.replace("(PRU-157)", "(PRU-999)"));
  assert.ok(errors.some(finding => /PRU-999/.test(finding.message)), JSON.stringify(errors));
});

test("mutation: removing a section from the index fails lint", () => {
  const errors = mutate(source => source.replace(/^- Section 15 [^\n]*\n/m, ""));
  assert.ok(errors.length > 0, "index mismatch not detected");
});
