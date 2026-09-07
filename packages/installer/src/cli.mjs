import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { CHAPTERS, estimateTokens, explainRule } from "@prumocode/compiler";
import { PrumoError, compactMapSource, describeError, findMapSource, lintMapSource, parseMapSource, searchState } from "@prumocode/runtime";
import { coverageReport, commandResponder, directoryResponder, fixtureResponder, loadSuites, runDoctor, runEvals, runStatus, lintRepository } from "@prumocode/verifier";
import { ADAPTERS } from "./adapters/index.mjs";
import { detectAll } from "./detect.mjs";
import { buildContext, repositoryRoot } from "./environment.mjs";
import { EXIT_CODES, exitCodeForError } from "./exit-codes.mjs";
import { diff, install, listBackups, redactPlan, rollback, uninstall, update } from "./operations.mjs";
import { verifyRuntimeHome } from "./runtime-home.mjs";

const USAGE = `prumo <command> [options]

Install / lifecycle
  install [targets...]     install runtime, protocol and agent integrations (transactional)
  update [targets...]      recompile the protocol and migrate installed targets
  uninstall <t...>|--all   remove Prumo hooks, skills and managed blocks; foreign config is preserved
  rollback [id] [--list]   restore a backup snapshot
  diff [targets...]        show what install/update would change (secrets redacted)

Inspection
  status                   installed versions, target states, loaded chapters and token budget
  doctor                   full health check; non-zero exit on BROKEN/DRIFTED/PARTIAL
  lint                     canonical protocol, generated artifacts and README integrity
  explain PRU-xxx          rule text, section, chapter, source line and related rules
  chapter <id>             print a compiled chapter (${CHAPTERS.map(chapter => chapter.id).join(", ")})
  coverage                 enforcement classification per rule
  state [lint|search <q>|compact]  MapSource v2 operations in the current workspace
  inspect [task-id]        local runtime receipts (~/.prumo/logs/runtime.ndjson)

Evals
  eval [--suite s] [--fixtures pass|fail] [--responses dir] [--command cmd]

Options
  --json  --dry-run  --yes  --no-statusline  --user-protocol  --all  --full
  --task "<text>"  --file <path>  --workspace <dir>  --home <dir>

Targets: ${ADAPTERS.map(adapter => adapter.id).join(", ")}
Exit codes: 0 ok, 1 failed, 2 usage, 3 protocol integrity, 4 drift, 5 unsupported, 6 partial (manual action)`;

export function parseArguments(argv) {
  const options = { positionals: [], files: [], suites: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      options.positionals.push(argument);
      continue;
    }
    const [rawKey, inlineValue] = argument.slice(2).split(/=(.*)/s);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const takesValue = ["task", "file", "workspace", "home", "suite", "responses", "command", "fixtures", "id"].includes(key);
    let value = true;
    if (takesValue) {
      value = inlineValue ?? argv[index + 1];
      if (value === undefined || (inlineValue === undefined && String(value).startsWith("--"))) throw new PrumoError("PRUMO_E_USAGE", `--${rawKey} requires a value`);
      if (inlineValue === undefined) index += 1;
    } else if (inlineValue !== undefined) value = inlineValue;
    if (key === "file") options.files.push(value);
    else if (key === "suite") options.suites.push(value);
    else if (key.startsWith("no") && key.length > 2 && key[2] === key[2].toUpperCase()) options[key[2].toLowerCase() + key.slice(3)] = false;
    else options[key] = value;
  }
  return options;
}

export async function runCli(argv, { stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, env = process.env, home, platform = process.platform, cwd = process.cwd() } = {}) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    stderr.write(`${error.message}\n\n${USAGE}\n`);
    return EXIT_CODES.USAGE;
  }
  const [command = "help", ...rest] = options.positionals;
  const json = Boolean(options.json);
  const emit = (payload, text) => {
    if (json) stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else stdout.write(`${text}\n`);
  };
  if (command === "help" || options.help) {
    stdout.write(`${USAGE}\n`);
    return EXIT_CODES.OK;
  }
  try {
    const root = repositoryRoot();
    const resolvedHome = options.home ?? home ?? undefined;
    const workspace = options.workspace ? join(cwd, options.workspace) : cwd;
    switch (command) {
      case "install":
      case "update": {
        const context = buildContext({ env, home: resolvedHome, platform, root, options: { statusline: options.statusline, userProtocol: options.userProtocol } });
        const targets = rest;
        const operation = command === "install" ? install : update;
        const preview = operation(context, { targets, dryRun: true });
        if (!options.yes && !options.dryRun && !json) {
          stdout.write(`${renderPlan(redactPlan(preview.plan), `${command} plan`)}\n`);
          if (preview.plan.changes === 0) {
            stdout.write("Nothing to change.\n");
            return EXIT_CODES.OK;
          }
          const confirmed = await confirm(stdin, stdout, `Apply ${preview.plan.changes} change(s)? [y/N] `);
          if (!confirmed) {
            stdout.write("Aborted; nothing was written.\n");
            return EXIT_CODES.OK;
          }
        }
        const result = operation(context, { targets, dryRun: Boolean(options.dryRun), onPhase: phase => !json && options.dryRun !== true && stderr.write(`  ${phase}\n`) });
        const plan = redactPlan(result.plan);
        emit({ command, status: result.status, targets: result.targets, changes: plan.changes, conflicts: plan.conflicts, backup: result.backup ?? null, verification: result.verification ?? [], comparison: result.comparison, plan: options.dryRun ? plan : undefined }, `${renderPlan(plan, options.dryRun ? `${command} dry-run` : `${command} ${result.status}`)}${renderVerification(result.verification)}${result.backup ? `\nBackup: ${result.backup}` : ""}`);
        return plan.conflicts.length > 0 ? EXIT_CODES.PARTIAL : EXIT_CODES.OK;
      }
      case "uninstall": {
        const context = buildContext({ env, home: resolvedHome, platform, root });
        if (rest.length === 0 && !options.all) throw new PrumoError("PRUMO_E_USAGE", "uninstall needs a target or --all");
        const result = uninstall(context, { targets: rest, all: Boolean(options.all), dryRun: Boolean(options.dryRun) });
        const plan = redactPlan(result.plan);
        emit({ command, status: result.status, targets: result.targets, removedRuntime: result.removedRuntime, changes: plan.changes, conflicts: plan.conflicts, backup: result.backup ?? null }, `${renderPlan(plan, options.dryRun ? "uninstall dry-run" : `uninstall ${result.status}`)}${result.backup ? `\nBackup: ${result.backup}` : ""}`);
        return plan.conflicts.length > 0 ? EXIT_CODES.PARTIAL : EXIT_CODES.OK;
      }
      case "rollback": {
        const context = buildContext({ env, home: resolvedHome, platform, root });
        if (options.list) {
          const backups = listBackups(context);
          emit({ backups }, backups.length === 0 ? "No backups." : backups.map(entry => `${entry.id}  ${entry.operation.padEnd(9)} ${entry.files} file(s)  ${entry.createdAt}`).join("\n"));
          return EXIT_CODES.OK;
        }
        const result = rollback(context, { id: rest[0] ?? options.id, dryRun: Boolean(options.dryRun) });
        emit({ command, backup: result.backup, restored: result.restored, dryRun: Boolean(result.dryRun), entries: result.manifest.entries }, `${result.dryRun ? "Would restore" : "Restored"} ${result.manifest.entries.length} path(s) from ${result.backup.id} (${result.backup.operation})\n${result.manifest.entries.map(entry => `  ${entry.existed ? "restore" : "remove "} ${entry.path}`).join("\n")}`);
        return EXIT_CODES.OK;
      }
      case "diff": {
        const context = buildContext({ env, home: resolvedHome, platform, root });
        const result = diff(context, { targets: rest, mode: context.journal ? "update" : "install" });
        emit(result, renderPlan(result.plan, `diff (${context.journal ? "update" : "install"})`));
        return EXIT_CODES.OK;
      }
      case "status": {
        const context = buildContext({ env, home: resolvedHome, platform, root });
        const detections = detectAll(ADAPTERS, env, context.home);
        const result = runStatus({ context, adapters: ADAPTERS, detections, workspace, task: options.task, files: options.files, full: Boolean(options.full) });
        emit(result, renderStatus(result));
        return EXIT_CODES.OK;
      }
      case "doctor": {
        const context = buildContext({ env, home: resolvedHome, platform, root });
        const result = runDoctor({ context, adapters: ADAPTERS, verifyRuntimeHome, workspace, includeProject: options.project !== false });
        emit(result, renderDoctor(result));
        return EXIT_CODES[result.summary.exit] ?? EXIT_CODES.FAILED;
      }
      case "lint": {
        const result = lintRepository(root);
        emit({ errors: result.errors, warnings: result.warnings, ruleCount: result.compiled.manifest.ruleCount, protocolVersion: result.compiled.protocolVersion }, renderLint(result));
        return result.errors.length > 0 ? EXIT_CODES.PROTOCOL_INTEGRITY : EXIT_CODES.OK;
      }
      case "explain": {
        const id = rest[0];
        if (!id) throw new PrumoError("PRUMO_E_USAGE", "explain needs a rule id, e.g. prumo explain PRU-158");
        const context = buildContext({ env, home: resolvedHome, platform, root });
        const rule = explainRule(context.manifest, id, context.compiled.ast);
        if (!rule) {
          emit({ error: `unknown rule ${id}` }, `Unknown rule ${id}. Range: ${context.manifest.ruleRange.first} to ${context.manifest.ruleRange.last}.`);
          return EXIT_CODES.USAGE;
        }
        emit(rule, renderRule(rule));
        return EXIT_CODES.OK;
      }
      case "chapter": {
        const id = rest[0];
        const chapter = CHAPTERS.find(entry => entry.id === id);
        if (!chapter) throw new PrumoError("PRUMO_E_USAGE", `unknown chapter "${id}"; known: ${CHAPTERS.map(entry => entry.id).join(", ")}`);
        const context = buildContext({ env, home: resolvedHome, platform, root });
        const text = context.artifacts.get(`chapters/${id}.md`);
        emit({ id, tokens: estimateTokens(text), text }, text);
        return EXIT_CODES.OK;
      }
      case "coverage": {
        const context = buildContext({ env, home: resolvedHome, platform, root });
        const suites = loadSuites(join(root, "evals"));
        const report = coverageReport(context.manifest, suites);
        emit(report, renderCoverage(report));
        return report.unclassifiedCritical.length > 0 || report.gaps.length > 0 ? EXIT_CODES.PROTOCOL_INTEGRITY : EXIT_CODES.OK;
      }
      case "state":
        return stateCommand(rest, { workspace, emit, json });
      case "inspect": {
        const context = buildContext({ env, home: resolvedHome, platform, root });
        const path = context.layout.runtimeLogPath;
        const lines = existsSync(path) ? readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
        const filtered = rest[0] ? lines.filter(entry => JSON.stringify(entry).includes(rest[0])) : lines.slice(-20);
        emit({ path, receipts: filtered }, filtered.length === 0 ? `No receipts${rest[0] ? ` matching ${rest[0]}` : ""} in ${path}` : filtered.map(entry => `${entry.timestamp}  ${entry.event ?? "-"}  ${entry.adapter ?? "-"}  ${entry.errorCode ?? entry.code ?? ""} ${entry.path ?? ""}`.trimEnd()).join("\n"));
        return EXIT_CODES.OK;
      }
      case "eval": {
        const context = buildContext({ env, home: resolvedHome, platform, root });
        const evalsDir = join(root, "evals");
        const suites = loadSuites(evalsDir, { only: options.suites });
        const responder = options.command ? commandResponder(options.command, { env }) : options.responses ? directoryResponder(join(cwd, options.responses)) : fixtureResponder(evalsDir, options.fixtures ?? "pass");
        const expect = options.command || options.responses ? undefined : (options.fixtures ?? "pass");
        const result = runEvals({ evalsDir, suites, responder, expect, criticalRules: context.manifest.critical });
        emit(result, renderEvals(result, { mode: options.command ? "command" : options.responses ? "responses" : `fixtures:${options.fixtures ?? "pass"}` }));
        return result.totals.errors > 0 || result.gates.core === "FAIL" || result.gates.critical === "FAIL" ? EXIT_CODES.FAILED : EXIT_CODES.OK;
      }
      default:
        stderr.write(`Unknown command "${command}".\n\n${USAGE}\n`);
        return EXIT_CODES.USAGE;
    }
  } catch (error) {
    const described = describeError(error);
    if (json) stdout.write(`${JSON.stringify({ error: described, detail: error instanceof PrumoError ? error.detail : undefined }, null, 2)}\n`);
    else stderr.write(`${described.code}: ${described.message}\n  ${described.hint}\n`);
    if (error instanceof PrumoError && error.detail?.findings && !json) for (const finding of error.detail.findings) stderr.write(`  - ${finding.message}\n`);
    return exitCodeForError(error);
  }
}

function stateCommand(rest, { workspace, emit }) {
  const path = findMapSource(workspace);
  if (!path) {
    emit({ error: "no MapSource.md" }, `No MapSource.md in ${workspace}. Template: ~/.prumo/protocol/templates/MapSource.md`);
    return EXIT_CODES.FAILED;
  }
  const text = readFileSync(path, "utf8");
  const [sub = "show", ...args] = rest;
  if (sub === "lint") {
    const findings = lintMapSource(text);
    emit({ path, findings }, findings.length === 0 ? `MapSource schema OK (${Buffer.byteLength(text, "utf8")} bytes)` : findings.map(entry => `${entry.severity.toUpperCase().padEnd(7)} ${entry.code}  ${entry.message}`).join("\n"));
    return findings.some(entry => entry.severity === "error") ? EXIT_CODES.FAILED : EXIT_CODES.OK;
  }
  if (sub === "search") {
    const query = args.join(" ");
    if (!query) throw new PrumoError("PRUMO_E_USAGE", "state search needs a query");
    const hits = searchState(query, { mapSourceText: text, historyDir: join(workspace, ".prumo", "history") });
    emit({ query, hits }, hits.length === 0 ? "No matches." : hits.map(hit => `${hit.source}: ${hit.line}`).join("\n"));
    return EXIT_CODES.OK;
  }
  if (sub === "compact") {
    const result = compactMapSource(text, { historyDir: join(workspace, ".prumo", "history") });
    emit(result, result.moved?.length ? `Moved ${result.moved.length} closed item(s) to .prumo/history (${result.bytesBefore} -> ${result.bytesAfter} bytes)` : "Nothing to compact.");
    return EXIT_CODES.OK;
  }
  const parsed = parseMapSource(text);
  emit({ path, bytes: parsed.bytes, sections: Object.keys(parsed.sections), suspicion: parsed.suspicion.length, rootCauses: parsed.rootCauses.length, frontMatter: parsed.frontMatter }, `${path}\n${parsed.bytes} bytes, schema ${parsed.frontMatter?.schema ?? "?"}, ${parsed.suspicion.length} suspicion item(s), ${parsed.rootCauses.length} root cause(s)`);
  return EXIT_CODES.OK;
}

async function confirm(stdin, stdout, prompt) {
  if (!stdin.isTTY) return false;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await new Promise(resolve => rl.question(prompt, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export function renderPlan(plan, title) {
  const lines = [title];
  for (const group of plan.groups) {
    const changed = group.steps.filter(step => step.changed || step.conflict);
    lines.push(`\n${group.label ?? group.adapter}${changed.length === 0 ? "  (no changes)" : ""}`);
    const byPath = new Map();
    const fileSteps = changed.filter(step => (step.kind === "file" || step.kind === "delete") && !step.conflict);
    const collapse = fileSteps.length > 6;
    for (const step of changed) {
      if (collapse && fileSteps.includes(step)) continue;
      byPath.set(step.path, [...(byPath.get(step.path) ?? []), ...step.summary]);
    }
    if (collapse) {
      const prefix = commonPrefix(fileSteps.map(step => step.path));
      const counts = { create: 0, modify: 0, delete: 0 };
      for (const step of fileSteps) counts[step.operation ?? "modify"] += 1;
      lines.push(`  ${prefix}${prefix.endsWith("\\") || prefix.endsWith("/") ? "" : "/"}...`);
      lines.push(`    ${[counts.create && `+ ${counts.create} file(s) created`, counts.modify && `~ ${counts.modify} file(s) rewritten`, counts.delete && `- ${counts.delete} file(s) deleted`].filter(Boolean).join(", ")}`);
    }
    const unchangedFiles = group.steps.filter(step => !step.changed && !step.conflict && step.kind === "file").length;
    for (const [path, summary] of byPath) {
      lines.push(`  ${path}`);
      for (const line of summary) lines.push(`    ${line}`);
    }
    if (unchangedFiles > 0 && changed.length > 0) lines.push(`  (${unchangedFiles} file(s) already current)`);
  }
  if (plan.conflicts.length > 0) {
    lines.push("\nConflicts (left untouched, manual action required):");
    for (const conflict of plan.conflicts) lines.push(`  ${conflict.path}: ${conflict.reason}`);
  }
  lines.push(`\n${plan.changes} change(s)`);
  return lines.join("\n");
}

function commonPrefix(paths) {
  if (paths.length === 0) return "";
  const split = paths.map(path => path.split(/[\\/]/));
  const common = [];
  for (let index = 0; index < split[0].length - 1; index += 1) {
    const segment = split[0][index];
    if (split.every(parts => parts[index] === segment)) common.push(segment);
    else break;
  }
  return common.join(paths[0].includes("\\") ? "\\" : "/");
}

function renderVerification(verification = []) {
  if (verification.length === 0) return "";
  return `\n\nVerification\n${verification.map(entry => `  ${entry.adapter.padEnd(9)} ${entry.state}`).join("\n")}`;
}

function renderStatus(result) {
  const lines = [`Prumo ${result.installer}`, "", `Protocol    ${result.protocol.version}${result.protocol.installed ? "" : " (not installed; repository)"}${result.protocol.drift ? `  (repository has ${result.protocol.repositoryVersion} ${result.protocol.repositoryHash.slice(0, 8)}; run prumo update)` : ""}`, `Hash        ${result.protocol.hash.slice(0, 12)}`, `Runtime     ${result.runtime.version}${result.runtime.installed ? "" : " (hook missing)"}`, `Project     ${result.workspace}`];
  for (const bridge of result.bridges) lines.push(`Bridge      ${bridge.file.padEnd(10)} ${bridge.state}  ${bridge.reason}`);
  lines.push(`MapSource   ${result.mapsource.state}${result.mapsource.bytes ? ` (${result.mapsource.bytes} bytes)` : ""}`, "");
  for (const target of result.targets) lines.push(`${target.label.padEnd(24)} ${target.state.padEnd(14)} ${target.reason ?? ""}`.trimEnd());
  lines.push("", "Kernel: active", "Loaded chapters:");
  for (const chapter of result.working.chapters) lines.push(`  ${chapter.id.padEnd(14)} ${chapter.reasons.join("; ")}`);
  for (const refused of result.working.refused) lines.push(`  ${refused.chapter.padEnd(14)} kept: ${refused.reason}`);
  lines.push("", `Rules in current working set: ${result.working.rules.active} / ${result.working.rules.total}`, "", "Context (estimated tokens):", `  kernel   ${String(result.working.tokens.kernel).padStart(6)}`, `  chapters ${String(result.working.tokens.chapters).padStart(6)}`, `  state    ${String(result.working.tokens.state).padStart(6)}`, `  total    ${String(result.working.tokens.total).padStart(6)}`);
  return lines.join("\n");
}

function renderDoctor(result) {
  const lines = result.checks.map(check => `${check.status.padEnd(4)} ${check.name.padEnd(30)} ${check.detail}${check.details?.length ? `\n${check.details.map(detail => `       - ${detail}`).join("\n")}` : ""}`);
  lines.push("", `${result.summary.PASS} pass, ${result.summary.WARN} warn, ${result.summary.FAIL} fail, ${result.summary.SKIP} skipped -> ${result.summary.exit}`);
  return lines.join("\n");
}

function renderLint(result) {
  if (result.findings.length === 0) return `Protocol ${result.compiled.protocolVersion}: ${result.compiled.manifest.ruleCount} rules, no findings.`;
  return result.findings.map(entry => `${entry.severity.toUpperCase().padEnd(7)} ${entry.code.padEnd(24)} ${entry.message}`).join("\n") + `\n\n${result.errors.length} error(s), ${result.warnings.length} warning(s)`;
}

function renderRule(rule) {
  return [`${rule.id} — ${rule.title}`, "", rule.text ?? "", "", `Section: ${rule.section}`, `Chapter: ${rule.chapter}`, `Tier: ${rule.tier}${rule.critical ? " (critical)" : ""}`, `Enforcement: ${rule.enforcement}${rule.evalSuite ? ` (eval suite ${rule.evalSuite})` : ""}`, `Source: ${rule.source.file}:${rule.source.line}`, `Related: ${rule.related.length ? rule.related.join(", ") : "none"}`].join("\n");
}

function renderCoverage(report) {
  const lines = report.rows.map(row => `${row.id.padEnd(8)} ${String(row.enforcement).padEnd(26)}${row.critical ? " critical" : ""}${row.suites.length ? `  ${row.suites.join(",")}` : ""}`);
  lines.push("", Object.entries(report.counts).map(([key, value]) => `${key} ${value}`).join("  "));
  if (report.gaps.length) lines.push(`BEHAVIOR_EVAL rules without a suite: ${report.gaps.map(row => row.id).join(", ")}`);
  if (report.unclassifiedCritical.length) lines.push(`Critical rules without classification: ${report.unclassifiedCritical.map(row => row.id).join(", ")}`);
  return lines.join("\n");
}

function renderEvals(result, { mode }) {
  const lines = [`Behavioral evals (${mode})`, ""];
  for (const suite of result.results) {
    lines.push(`${suite.suite.padEnd(22)} ${suite.passed}/${suite.judged}${suite.skipped ? ` (${suite.skipped} skipped)` : ""}${suite.errors ? ` (${suite.errors} errors)` : ""}${suite.critical ? "  critical" : ""}`);
    for (const testCase of suite.cases) {
      if (testCase.status === "PASS") continue;
      lines.push(`  ${testCase.status.padEnd(5)} ${testCase.id}`);
      for (const failure of testCase.failures) lines.push(`        ${failure}`);
    }
  }
  const percent = value => (value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`);
  lines.push("", `core pass rate     ${percent(result.corePassRate)}  gate ${result.gates.core}`, `critical pass rate ${percent(result.criticalPassRate)}  gate ${result.gates.critical}`);
  return lines.join("\n");
}
