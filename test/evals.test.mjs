import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { install } from "@prumocode/installer";
import { runHook } from "@prumocode/runtime";
import { coverageReport, fixtureResponder, judgeResponse, loadSuites, runEvals, touchedFiles } from "@prumocode/verifier";
import { ROOT, compiled, contextFor, tempHome } from "./helpers.mjs";

const EVALS_DIR = join(ROOT, "evals");
const REQUIRED_SUITES = ["sycophancy", "pressure-resistance", "gold-plating", "false-verification", "debug-hypothesis", "three-run-breaker", "security-trigger", "foreign-instructions", "scope-discipline", "user-correction"];

const fixtures = [];
after(() => fixtures.forEach(entry => entry.cleanup()));

test("every required behavioral suite exists, is critical-aware and cites real rules", () => {
  const suites = loadSuites(EVALS_DIR);
  const ids = suites.map(suite => suite.suite);
  for (const required of REQUIRED_SUITES) assert.ok(ids.includes(required), `missing suite ${required}`);
  const known = new Set(compiled().manifest.rules.map(rule => rule.id));
  for (const suite of suites) {
    for (const rule of suite.rules ?? []) assert.ok(known.has(rule), `${suite.suite} cites unknown ${rule}`);
    assert.ok(suite.cases.length > 0);
    for (const testCase of suite.cases) {
      assert.ok(testCase.fixtures?.pass && testCase.fixtures?.fail, `${suite.suite}/${testCase.id} lacks pass/fail fixtures`);
      for (const variant of ["pass", "fail"]) assert.ok(existsSync(join(EVALS_DIR, "fixtures", ...testCase.fixtures[variant].split("/"))), `${suite.suite}/${testCase.id} ${variant} fixture missing`);
    }
  }
});

test("pass fixtures pass and fail fixtures fail in every suite; release gates hold on the fixtures", () => {
  const suites = loadSuites(EVALS_DIR);
  const critical = compiled().manifest.critical;
  const passing = runEvals({ evalsDir: EVALS_DIR, suites, responder: fixtureResponder(EVALS_DIR, "pass"), expect: "pass", criticalRules: critical });
  const failing = runEvals({ evalsDir: EVALS_DIR, suites, responder: fixtureResponder(EVALS_DIR, "fail"), expect: "fail", criticalRules: critical });
  for (const run of [passing, failing]) {
    const broken = run.results.flatMap(result => result.cases.filter(entry => entry.status !== "PASS").map(entry => `${result.suite}/${entry.id}: ${entry.failures.join("; ")}`));
    assert.deepEqual(broken, []);
    assert.equal(run.gates.core, "PASS");
    assert.equal(run.gates.critical, "PASS");
    assert.equal(run.totals.skipped, 0);
    assert.equal(run.totals.errors, 0);
  }
  assert.ok(passing.totals.cases >= REQUIRED_SUITES.length);
});

test("the judge is strict about verdict-first, forbidden phrases and file discipline", () => {
  const judge = { verdictFirst: true, verdictPattern: "^(no|yes)\\b", mustMatch: ["\\brisk\\b"], mustNotMatch: ["great idea"] };
  assert.equal(judgeResponse("No. The risk is XSS.", judge).pass, true);
  assert.equal(judgeResponse("Great idea! No risk though.", judge).pass, false);
  assert.equal(judgeResponse("Well, the risk is there. No.", judge).pass, false, "verdict must come first");
  const files = touchedFiles("```diff\ndiff --git a/src/date.ts b/src/date.ts\n--- a/src/date.ts\n+++ b/src/date.ts\n```\n\n```\nM src/date.test.ts\nA lib/util.ts\n```");
  assert.deepEqual(files.sort(), ["lib/util.ts", "src/date.test.ts", "src/date.ts"]);
});

test("foreign-instructions is judged on real runtime output, not a hand-written transcript", () => {
  const home = tempHome();
  fixtures.push(home);
  install(contextFor(home), { targets: ["codex"] });
  const workspace = join(home.home, "workspace");
  mkdirSync(workspace);
  const fixtureAgents = readFileSync(join(EVALS_DIR, "fixtures", "foreign-instructions", "workspace", "AGENTS.md"), "utf8");
  writeFileSync(join(workspace, "AGENTS.md"), fixtureAgents);
  const result = runHook({ argv: ["--cli=codex"], rawPayload: JSON.stringify({ cwd: workspace }), env: home.env, home: home.home, cwd: workspace });
  const suite = loadSuites(EVALS_DIR, { only: ["foreign-instructions"] })[0];
  const verdict = judgeResponse(result.stdout, suite.cases[0].judge);
  assert.equal(verdict.pass, true, JSON.stringify(verdict.failures));
  assert.equal(readFileSync(join(workspace, "AGENTS.md"), "utf8"), fixtureAgents);
});

test("coverage report classifies every rule and leaves no critical rule unclassified", () => {
  const manifest = compiled().manifest;
  const report = coverageReport(manifest, loadSuites(EVALS_DIR));
  assert.equal(report.rows.length, manifest.ruleCount);
  const categories = new Set(["ENFORCED", "DETERMINISTICALLY_TESTED", "BEHAVIOR_EVAL", "DOCUMENTARY", "MANUAL"]);
  for (const row of report.rows) assert.ok(categories.has(row.enforcement), `${row.id}: ${row.enforcement}`);
  assert.deepEqual(report.unclassifiedCritical, []);
  for (const id of manifest.critical) {
    const row = report.rows.find(entry => entry.id === id);
    assert.ok(row, `critical ${id} missing from coverage`);
    assert.ok(["BEHAVIOR_EVAL", "DETERMINISTICALLY_TESTED", "ENFORCED"].includes(row.enforcement), `critical ${id} is ${row.enforcement}`);
    if (row.enforcement === "BEHAVIOR_EVAL") assert.ok(row.suites.length > 0, `critical ${id} claims BEHAVIOR_EVAL but no suite covers it`);
  }
  assert.deepEqual(report.gaps.map(row => row.id), [], "rules classified BEHAVIOR_EVAL without a suite");
  // PRU-99 (never push without request) has no blocking hook: it must not be called ENFORCED (PRU-261).
  assert.notEqual(report.rows.find(row => row.id === "PRU-99")?.enforcement, "ENFORCED");
});
