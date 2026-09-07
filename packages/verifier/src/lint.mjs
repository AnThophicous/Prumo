import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { compileFromRepository, readmeBlockIsCurrent } from "@prumocode/compiler";

export function listGenerated(directory, prefix = "") {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const name = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(path).isDirectory()) files.push(...listGenerated(path, name));
    else files.push(name);
  }
  return files.sort();
}

export function generatedFreshness(root, compiled) {
  const generatedDir = join(root, "generated");
  const findings = [];
  const present = new Set(listGenerated(generatedDir));
  for (const [name, content] of compiled.files) {
    const path = join(generatedDir, ...name.split("/"));
    if (!existsSync(path)) {
      findings.push({ severity: "error", code: "generated-missing", message: `generated/${name} is missing; run npm run build` });
      continue;
    }
    const current = readFileSync(path, "utf8");
    if (normalize(current) !== normalize(content)) findings.push({ severity: "error", code: "generated-stale", message: `generated/${name} is stale; run npm run build`, file: relative(root, path) });
    present.delete(name);
  }
  for (const orphan of present) findings.push({ severity: "error", code: "generated-orphan", message: `generated/${orphan} is not produced by the compiler; delete it` });
  return findings;
}

export function readmeFreshness(root, compiled) {
  const readmePath = join(root, "README.md");
  if (!existsSync(readmePath)) return [{ severity: "error", code: "readme-missing", message: "README.md is missing" }];
  const readme = readFileSync(readmePath, "utf8");
  const block = compiled.files.get("readme-block.md");
  if (!readmeBlockIsCurrent(normalize(readme), normalize(block))) return [{ severity: "error", code: "readme-stale", message: "README.md generated block is stale (rule count, version or targets); run npm run build" }];
  const stray = readme.replace(/<!-- PRUMO:GENERATED:BEGIN -->[\s\S]*?<!-- PRUMO:GENERATED:END -->/, "").match(/\b\d{3}\s+(?:normative\s+)?rules\b/i);
  if (stray) return [{ severity: "warning", code: "readme-manual-count", message: `README.md mentions "${stray[0]}" outside the generated block; move counts into the managed block` }];
  return [];
}

export function lintRepository(root) {
  const compiled = compileFromRepository(root);
  const findings = [...compiled.findings, ...generatedFreshness(root, compiled), ...readmeFreshness(root, compiled)];
  return { compiled, findings, errors: findings.filter(entry => entry.severity === "error"), warnings: findings.filter(entry => entry.severity === "warning") };
}

function normalize(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n");
}
