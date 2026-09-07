import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export const BRIDGE_FILE_BY_CLI = {
  claude: "CLAUDE.md",
  codex: "AGENTS.md",
  cursor: "AGENTS.md",
  grok: "AGENTS.md",
  gemini: "GEMINI.md",
  generic: "AGENTS.md"
};

export function prumoHome(env = process.env, home = homedir()) {
  const configured = env.PRUMO_HOME;
  if (typeof configured === "string" && configured.trim().length > 0) return configured.trim();
  return join(home, ".prumo");
}

export function layout(env = process.env, home = homedir()) {
  const root = prumoHome(env, home);
  return {
    root,
    protocolDir: join(root, "protocol"),
    manifestPath: join(root, "protocol", "protocol.manifest.json"),
    kernelPath: join(root, "protocol", "kernel", "PRUMO-KERNEL.md"),
    reminderPath: join(root, "protocol", "reminder.txt"),
    chaptersDir: join(root, "protocol", "chapters"),
    agentsDir: join(root, "protocol", "agents"),
    skillsDir: join(root, "protocol", "skills"),
    fullProtocolPath: join(root, "protocol", "full", "PRUMO.md"),
    runtimeDir: join(root, "runtime"),
    hookPath: join(root, "runtime", "hooks", "prumo-hook.mjs"),
    statuslinePath: join(root, "runtime", "statusline", "prumo-statusline.mjs"),
    stateDir: join(root, "state"),
    installJournalPath: join(root, "state", "install.json"),
    projectsStateDir: join(root, "state", "projects"),
    backupsDir: join(root, "backups"),
    logsDir: join(root, "logs"),
    runtimeLogPath: join(root, "logs", "runtime.ndjson"),
    receiptsDir: join(root, "receipts")
  };
}

export function bridgeFileFor(cli) {
  return BRIDGE_FILE_BY_CLI[cli] ?? BRIDGE_FILE_BY_CLI.generic;
}

export function sha256(text) {
  return createHash("sha256").update(String(text).replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

export function projectStateKey(workspace) {
  return sha256(String(workspace).replace(/\\/g, "/").toLowerCase()).slice(0, 24);
}

export function redactPath(path, home = homedir()) {
  if (typeof path !== "string") return undefined;
  const normalized = path.replace(/\\/g, "/");
  const normalizedHome = home.replace(/\\/g, "/");
  if (normalizedHome && normalized.toLowerCase().startsWith(normalizedHome.toLowerCase())) return `~${normalized.slice(normalizedHome.length)}`;
  return normalized;
}
