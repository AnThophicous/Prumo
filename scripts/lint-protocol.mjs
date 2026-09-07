#!/usr/bin/env node
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lintRepository } from "@prumocode/verifier";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const result = lintRepository(root);
for (const finding of result.findings) console.log(`${finding.severity.toUpperCase().padEnd(7)} ${finding.code.padEnd(24)} ${finding.message}`);
console.log(`\nprotocol ${result.compiled.protocolVersion}: ${result.compiled.manifest.ruleCount} rules, ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
process.exit(result.errors.length > 0 ? 3 : 0);
