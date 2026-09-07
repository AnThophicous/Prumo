import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { layout, redactPath } from "./paths.mjs";

const ALLOWED_FIELDS = ["event", "adapter", "code", "path", "state", "action", "durationMs"];

export function buildReceipt(fields, { now = new Date(), home = homedir(), debug = false } = {}) {
  const receipt = { ts: now.toISOString() };
  for (const field of ALLOWED_FIELDS) {
    if (fields[field] === undefined) continue;
    receipt[field] = field === "path" ? redactPath(fields[field], home) : fields[field];
  }
  if (debug && fields.detail !== undefined) receipt.detail = String(fields.detail).slice(0, 500);
  return receipt;
}

export function appendReceipt(fields, { env = process.env, home = homedir(), now = new Date() } = {}) {
  const receipt = buildReceipt(fields, { now, home, debug: env.PRUMO_DEBUG === "1" });
  const target = layout(env, home).runtimeLogPath;
  try {
    mkdirSync(dirname(target), { recursive: true });
    appendFileSync(target, `${JSON.stringify(receipt)}\n`);
    return { written: true, receipt, path: target };
  } catch (error) {
    if (env.PRUMO_DEBUG === "1") process.stderr.write(`prumo: could not write ${target}: ${error instanceof Error ? error.message : String(error)}\n`);
    return { written: false, receipt, path: target };
  }
}
