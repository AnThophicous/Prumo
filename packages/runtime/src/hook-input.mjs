import { realpathSync, statSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import { PrumoError } from "./errors.mjs";

export const PAYLOAD_LIMIT_BYTES = 1_000_000;
export const PATH_LIMIT_CHARACTERS = 4096;

const KNOWN_PAYLOAD_KEYS = new Set([
  "session_id", "sessionId", "transcript_path", "cwd", "hook_event_name", "hookEventName", "source", "model",
  "workspace", "workspaceRoot", "workspace_roots", "prompt", "permission_mode", "conversation_id", "generation_id",
  "user_email", "timestamp", "event", "tool_name", "tool_input", "custom_instructions", "agent_config"
]);

export function parsePayload(raw) {
  if (raw === undefined || raw === null || raw === "") return { payload: {}, warnings: ["empty payload"] };
  if (Buffer.byteLength(raw, "utf8") > PAYLOAD_LIMIT_BYTES) throw new PrumoError("PRUMO_E_PAYLOAD_INVALID", `hook payload exceeds ${PAYLOAD_LIMIT_BYTES} bytes`);
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new PrumoError("PRUMO_E_PAYLOAD_INVALID", `hook payload is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PrumoError("PRUMO_E_PAYLOAD_INVALID", "hook payload is not a JSON object");
  const warnings = Object.keys(value).filter(key => !KNOWN_PAYLOAD_KEYS.has(key)).map(key => `unknown payload key "${key.slice(0, 40)}"`);
  return { payload: value, warnings };
}

export function workspaceCandidates(payload = {}, env = {}) {
  return [
    payload.workspace?.current_dir,
    payload.workspace?.project_dir,
    payload.workspaceRoot,
    Array.isArray(payload.workspace_roots) ? payload.workspace_roots[0] : undefined,
    payload.cwd,
    env.PRUMO_WORKSPACE,
    env.GROK_WORKSPACE_ROOT,
    env.GEMINI_PROJECT_DIR,
    env.CLAUDE_PROJECT_DIR
  ];
}

export function validateWorkspace(candidate, { fs = { realpathSync, statSync } } = {}) {
  if (typeof candidate !== "string") return { ok: false, reason: "not a string" };
  const trimmed = candidate.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > PATH_LIMIT_CHARACTERS) return { ok: false, reason: "too long" };
  if (/[\u0000\r\n]/.test(trimmed)) return { ok: false, reason: "contains a control character" };
  const normalized = normalize(trimmed);
  if (!isAbsolute(normalized)) return { ok: false, reason: "not absolute" };
  let real;
  try {
    real = fs.realpathSync(normalized);
  } catch {
    return { ok: false, reason: "does not exist" };
  }
  let stats;
  try {
    stats = fs.statSync(real);
  } catch {
    return { ok: false, reason: "cannot stat" };
  }
  if (!stats.isDirectory()) return { ok: false, reason: "not a directory" };
  return { ok: true, workspace: real, symlinked: real !== normalized };
}

export function resolveWorkspace(payload, env = process.env, fallback = process.cwd(), options = {}) {
  const rejected = [];
  for (const candidate of [...workspaceCandidates(payload, env), fallback]) {
    if (candidate === undefined) continue;
    const result = validateWorkspace(candidate, options);
    if (result.ok) return { ...result, rejected };
    rejected.push({ reason: result.reason });
  }
  throw new PrumoError("PRUMO_E_WORKSPACE_INVALID", `no workspace candidate is an existing directory (${rejected.map(entry => entry.reason).join(", ")})`, { rejected });
}
