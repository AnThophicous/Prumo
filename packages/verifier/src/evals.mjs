import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PrumoError } from "@prumocode/runtime";
import { judgeResponse } from "./judge.mjs";

export const RELEASE_GATES = Object.freeze({ corePassRate: 0.95, criticalPassRate: 1 });

export function loadSuites(evalsDir, { only } = {}) {
  const behaviorDir = join(evalsDir, "behavior");
  if (!existsSync(behaviorDir)) throw new PrumoError("PRUMO_E_PROTOCOL_MISSING", `no eval suites at ${behaviorDir}`);
  const suites = readdirSync(behaviorDir)
    .filter(entry => entry.endsWith(".json"))
    .map(entry => ({ ...JSON.parse(readFileSync(join(behaviorDir, entry), "utf8")), file: join(behaviorDir, entry) }))
    .sort((left, right) => left.suite.localeCompare(right.suite));
  if (only && only.length > 0) {
    const missing = only.filter(name => !suites.some(suite => suite.suite === name));
    if (missing.length > 0) throw new PrumoError("PRUMO_E_UNSUPPORTED_VERSION", `unknown eval suite(s): ${missing.join(", ")}; available: ${suites.map(suite => suite.suite).join(", ")}`);
    return suites.filter(suite => only.includes(suite.suite));
  }
  return suites;
}

export function fixtureResponder(evalsDir, variant) {
  return (suite, testCase) => {
    const relative = testCase.fixtures?.[variant];
    if (!relative) throw new PrumoError("PRUMO_E_PROTOCOL_MISSING", `${suite.suite}/${testCase.id} has no "${variant}" fixture`);
    const path = join(evalsDir, "fixtures", ...relative.split("/"));
    if (!existsSync(path)) throw new PrumoError("PRUMO_E_PROTOCOL_MISSING", `fixture missing: ${path}`);
    return readFileSync(path, "utf8");
  };
}

export function directoryResponder(directory) {
  return (suite, testCase) => {
    const path = join(directory, suite.suite, `${testCase.id}.md`);
    if (!existsSync(path)) return undefined;
    return readFileSync(path, "utf8");
  };
}

export function commandResponder(command, { timeoutMs = 120000, env = process.env } = {}) {
  return (suite, testCase) => {
    const payload = JSON.stringify({ suite: suite.suite, case: testCase.id, rules: suite.rules, turns: testCase.turns, fixture: testCase.workspace ?? null });
    const result = spawnSync(command, { input: payload, encoding: "utf8", shell: true, timeout: timeoutMs, env, windowsHide: true });
    if (result.error) throw new PrumoError("PRUMO_E_TRANSACTION", `eval command failed: ${result.error.message}`);
    if (result.status !== 0) throw new PrumoError("PRUMO_E_TRANSACTION", `eval command exited ${result.status}: ${String(result.stderr).trim().slice(0, 400)}`);
    return result.stdout;
  };
}

export function runSuite(suite, responder, { expect } = {}) {
  const cases = suite.cases.map(testCase => {
    let response;
    try {
      response = responder(suite, testCase);
    } catch (error) {
      return { id: testCase.id, status: "ERROR", failures: [error instanceof Error ? error.message : String(error)], rules: testCase.rules ?? suite.rules };
    }
    if (response === undefined) return { id: testCase.id, status: "SKIP", failures: ["no response recorded"], rules: testCase.rules ?? suite.rules };
    const verdict = judgeResponse(response, testCase.judge);
    const expected = expect === undefined ? true : expect === "pass";
    const status = verdict.pass === expected ? "PASS" : "FAIL";
    const failures = expected ? verdict.failures : verdict.pass ? ["judge accepted a response that must fail"] : [];
    return { id: testCase.id, status, failures, evidence: verdict.evidence, rules: testCase.rules ?? suite.rules };
  });
  const judged = cases.filter(entry => entry.status === "PASS" || entry.status === "FAIL");
  return {
    suite: suite.suite,
    critical: Boolean(suite.critical),
    rules: suite.rules ?? [],
    cases,
    passed: judged.filter(entry => entry.status === "PASS").length,
    judged: judged.length,
    skipped: cases.filter(entry => entry.status === "SKIP").length,
    errors: cases.filter(entry => entry.status === "ERROR").length,
    passRate: judged.length === 0 ? undefined : judged.filter(entry => entry.status === "PASS").length / judged.length
  };
}

export function runEvals({ evalsDir, suites, responder, expect, criticalRules = [] }) {
  const results = suites.map(suite => runSuite(suite, responder, { expect }));
  const judged = results.flatMap(result => result.cases.filter(entry => entry.status === "PASS" || entry.status === "FAIL"));
  const critical = judged.filter(entry => (entry.rules ?? []).some(rule => criticalRules.includes(rule)));
  const rate = list => (list.length === 0 ? undefined : list.filter(entry => entry.status === "PASS").length / list.length);
  const corePassRate = rate(judged);
  const criticalPassRate = rate(critical);
  return {
    evalsDir,
    results,
    totals: { cases: judged.length, passed: judged.filter(entry => entry.status === "PASS").length, skipped: results.reduce((sum, result) => sum + result.skipped, 0), errors: results.reduce((sum, result) => sum + result.errors, 0) },
    corePassRate,
    criticalPassRate,
    gates: {
      core: corePassRate === undefined ? "NO_DATA" : corePassRate >= RELEASE_GATES.corePassRate ? "PASS" : "FAIL",
      critical: criticalPassRate === undefined ? "NO_DATA" : criticalPassRate >= RELEASE_GATES.criticalPassRate ? "PASS" : "FAIL"
    }
  };
}

export function coverageReport(manifest, suites = []) {
  const suiteByRule = new Map();
  for (const suite of suites) {
    for (const rule of suite.rules ?? []) suiteByRule.set(rule, [...(suiteByRule.get(rule) ?? []), suite.suite]);
    for (const testCase of suite.cases ?? []) for (const rule of testCase.rules ?? []) suiteByRule.set(rule, [...new Set([...(suiteByRule.get(rule) ?? []), suite.suite])]);
  }
  const rows = manifest.rules.map(rule => ({ id: rule.id, enforcement: rule.enforcement, critical: rule.critical, evalSuite: rule.evalSuite, suites: suiteByRule.get(rule.id) ?? [] }));
  const gaps = rows.filter(row => row.enforcement === "BEHAVIOR_EVAL" && row.suites.length === 0);
  const unclassifiedCritical = rows.filter(row => row.critical && !row.enforcement);
  return { rows, counts: manifest.coverage, gaps, unclassifiedCritical };
}
