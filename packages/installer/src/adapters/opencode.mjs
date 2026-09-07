import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  artifactFiles,
  check,
  deleteStep,
  fileStep,
  hookCommand,
  ownedFiles,
  summarizeState,
  verifyOwnedFile
} from "./contract.mjs";

// The compiler emits a single skill variant (skills/claude/). Its content is
// agent-agnostic markdown (kernel + chapter references) and opencode reads the
// same Agent Skills format (SKILL.md + references/), so this adapter installs
// those artifacts verbatim instead of duplicating them under a new prefix.
const SKILL_PREFIX = "skills/claude/";

function paths(home) {
  // opencode autoloads <config>/plugins/*.js at startup on every platform:
  // %USERPROFILE%\.config\opencode on Windows, ~/.config/opencode elsewhere.
  const root = join(home, ".config", "opencode");
  return { root, plugin: join(root, "plugins", "prumo-session.mjs"), skillDir: join(root, "skills", "prumo") };
}

function pluginSource(command) {
  return `// Installed by prumo install (opencode adapter). Do not edit: re-run install to update.
// Runs the Prumo session-start hook once per opencode session. Fail-open by
// design: any failure is swallowed so a session never breaks because of Prumo.
import { spawnSync } from "node:child_process";
const HOOK = { "command": ${JSON.stringify(command)} };
const SEEN_SESSIONS = new Set();
function runSessionStart(sessionID) {
  if (SEEN_SESSIONS.has(sessionID)) return;
  SEEN_SESSIONS.add(sessionID);
  try {
    spawnSync(HOOK.command, {
      shell: true,
      timeout: 15000,
      windowsHide: true,
      stdio: ["pipe", "ignore", "ignore"],
      input: JSON.stringify({ sessionID })
    });
  } catch { /* fail open */ }
}
export const PrumoSessionPlugin = async () => ({
  "session.created": async (input) => {
    runSessionStart(input?.sessionID ?? "default");
  }
});
`;
}

export const opencodeAdapter = {
  id: "opencode",
  label: "opencode",
  commands: ["opencode"],
  configDirs: home => [paths(home).root],
  capabilities: {
    hooks: { sessionStart: true, postCompact: false },
    persistentRules: "skills + AGENTS.md",
    skills: true,
    customStatusLine: false,
    projectInstructions: "AGENTS.md",
    userInstructions: "~/.config/opencode/skills/prumo/SKILL.md"
  },
  planInstall(context) {
    const target = paths(context.home);
    const command = hookCommand(context, "opencode", "session-start");
    return [
      fileStep({ id: "opencode.hook", title: "Install the opencode session plugin", path: target.plugin, content: pluginSource(command), adapter: "opencode" }),
      ...artifactFiles(context.artifacts, SKILL_PREFIX).map(entry => fileStep({ id: `opencode.skill:${entry.relative}`, title: `Install skill file ${entry.relative}`, path: join(target.skillDir, ...entry.relative.split("/")), content: entry.content, adapter: "opencode" }))
    ];
  },
  planUpdate(context) {
    return this.planInstall(context);
  },
  planUninstall(context, journal) {
    const target = paths(context.home);
    const recorded = (journal?.targets?.opencode?.mutations ?? []).find(entry => entry.step === "opencode.hook");
    return [
      deleteStep({ id: "opencode.hook", title: "Remove the opencode session plugin", path: target.plugin, adapter: "opencode", guardHash: recorded?.afterHash }),
      ...ownedFiles(journal, "opencode", target.skillDir, artifactFiles(context.artifacts, SKILL_PREFIX)).map(file => deleteStep({ id: `opencode.skill:${file.relative}`, title: `Remove skill file ${file.relative}`, path: file.path, adapter: "opencode", guardHash: file.afterHash }))
    ];
  },
  verifyInstall(context) {
    const target = paths(context.home);
    const command = hookCommand(context, "opencode", "session-start");
    const checks = [
      verifyOwnedFile("opencode.hook", target.plugin, pluginSource(command)),
      verifyOwnedFile("opencode.skill", join(target.skillDir, "SKILL.md"), context.artifacts.get(`${SKILL_PREFIX}SKILL.md`))
    ];
    return { state: summarizeState(checks, { requiredIds: ["opencode.hook", "opencode.skill"] }), checks };
  },
  diagnose(context) {
    const target = paths(context.home);
    const { checks } = this.verifyInstall(context);
    checks.push(check("opencode.config-dir", existsSync(target.root) ? true : "warn", existsSync(target.root) ? target.root : `${target.root} absent (opencode not initialised)`));
    return checks;
  }
};
