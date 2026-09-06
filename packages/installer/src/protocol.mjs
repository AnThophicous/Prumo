import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const PROTOCOL_MARKER = "PRU-01";

export const FILE_BY_CLI = {
  claude: "CLAUDE.md",
  codex: "AGENTS.md",
  cursor: "AGENTS.md",
  grok: "AGENTS.md",
  generic: "AGENTS.md"
};

export const REMINDER = [
  "PRUMO PROTOCOL ACTIVE.",
  "Read the protocol file at the project root before acting; it is normative and every rule has a stable id (PRU-xx).",
  "Non-negotiable core: read MapSource.md first (PRU-01) and update it at the end of each block of work (PRU-104).",
  "Write code, tests and log instrumentation in one pass (PRU-10). Stop after three non-converging runs and rebuild the hypothesis (PRU-16).",
  "No comments, no dead code, no placeholders (PRU-20 to PRU-22). Errors are handled or propagated (PRU-24).",
  "No preamble, no recap, no praise; report facts and say plainly when something is unverified (PRU-30 to PRU-33).",
  "Ask only when two readings lead to materially different work, at most four questions per round (PRU-41, PRU-43).",
  "Atomic commits with the full diff read first; never push or open a PR without an explicit request (PRU-91 to PRU-99).",
  "Record every suspicion with file:line and severity; never deliver a high-severity finding in silence (PRU-111, PRU-115).",
  "Public text carries verifiable numbers and varied rhythm, never borrowed emphasis (PRU-120 to PRU-127)."
].join(" ");

export function prumoHome(env = process.env, home = homedir()) {
  const configured = env.PRUMO_HOME;
  if (typeof configured === "string" && configured.trim().length > 0) return configured.trim();
  return join(home, ".prumo");
}

export function contentDirectories(env = process.env, home = homedir()) {
  return [
    join(prumoHome(env, home), "content"),
    join(here, "..", "content"),
    join(here, "..", "..", "..", "content")
  ];
}

export function resolveWorkspace(payload = {}, env = process.env, fallback = process.cwd()) {
  const candidates = [
    payload.workspace?.current_dir,
    payload.workspace?.project_dir,
    payload.workspaceRoot,
    payload.workspace_roots?.[0],
    payload.cwd,
    env.PRUMO_WORKSPACE,
    env.GROK_WORKSPACE_ROOT,
    fallback
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
  }
  return fallback;
}

export function protocolFileFor(cli) {
  return FILE_BY_CLI[cli] ?? FILE_BY_CLI.generic;
}

export function protocolSource(cli, directories = contentDirectories()) {
  const file = protocolFileFor(cli);
  for (const directory of directories) {
    const path = join(directory, file);
    if (existsSync(path)) return { path, file };
  }
  for (const directory of directories) {
    const path = join(directory, "PRUMO.md");
    if (existsSync(path)) return { path, file };
  }
  return undefined;
}

export function seedProtocol(workspace, cli, directories = contentDirectories()) {
  const source = protocolSource(cli, directories);
  if (!source) return { written: false, present: false, file: protocolFileFor(cli) };
  const target = join(workspace, source.file);
  if (existsSync(target)) return { written: false, present: true, file: source.file };
  try {
    mkdirSync(workspace, { recursive: true });
    writeFileSync(target, readFileSync(source.path, "utf8"));
    return { written: true, present: true, file: source.file };
  } catch {
    return { written: false, present: false, file: source.file };
  }
}

export function buildContext(seeded, workspace, cli) {
  const file = seeded.file ?? protocolFileFor(cli);
  if (seeded.written) return `${REMINDER} ${file} was written into ${workspace} by this hook.`;
  if (seeded.present) return `${REMINDER} ${file} is already present in ${workspace}.`;
  return `${REMINDER} ${file} could not be written into ${workspace}; read the protocol from the Prumo installation.`;
}

export function claudeEventName(event) {
  if (event === "prompt") return "UserPromptSubmit";
  if (event === "post-compact") return "PostCompact";
  return "SessionStart";
}

export function hookPayload(cli, event, context) {
  if (cli === "claude") {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: claudeEventName(event), additionalContext: context } });
  }
  if (cli === "cursor") return JSON.stringify({ additional_context: context });
  if (cli === "grok") return "";
  return context;
}
