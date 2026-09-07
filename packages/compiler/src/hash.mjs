import { createHash } from "node:crypto";

export function sha256(text) {
  return createHash("sha256").update(normalizeNewlines(text), "utf8").digest("hex");
}

export function shortHash(text) {
  return sha256(text).slice(0, 12);
}

export function normalizeNewlines(text) {
  return String(text).replace(/\r\n?/g, "\n");
}
