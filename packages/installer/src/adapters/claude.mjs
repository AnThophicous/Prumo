import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  addGroupedHook,
  artifactFiles,
  check,
  commandTargets,
  deleteStep,
  fileStep,
  hookCommand,
  jsoncStep,
  managedBlockStep,
  ownedFiles,
  readConfigObject,
  removeGroupedHook,
  removeManagedBlockStep,
  setStatusLine,
  statuslineCommand,
  summarizeState,
  unsetStatusLine,
  verifyGroupedHook,
  verifyManagedBlock,
  verifyOwnedFile
} from "./contract.mjs";

const SKILL_PREFIX = "skills/claude/";

function paths(home) {
  const root = join(home, ".claude");
  return { root, settings: join(root, "settings.json"), skillDir: join(root, "skills", "prumo"), userProtocol: join(root, "CLAUDE.md") };
}

export const claudeAdapter = {
  id: "claude",
  label: "Claude Code",
  commands: ["claude"],
  configDirs: home => [paths(home).root],
  capabilities: {
    hooks: { sessionStart: true, postCompact: "SessionStart refires with source=compact" },
    persistentRules: true,
    skills: true,
    customStatusLine: true,
    projectInstructions: "CLAUDE.md",
    userInstructions: "~/.claude/CLAUDE.md"
  },
  planInstall(context) {
    const target = paths(context.home);
    const steps = [
      jsoncStep({
        id: "claude.hook",
        title: "Register the SessionStart hook",
        path: target.settings,
        adapter: "claude",
        mutate: text => addGroupedHook(text, ["hooks", "SessionStart"], { type: "command", command: hookCommand(context, "claude", "session-start"), timeout: 15, statusMessage: "Loading Prumo protocol" })
      }),
      ...artifactFiles(context.artifacts, SKILL_PREFIX).map(entry => fileStep({ id: `claude.skill:${entry.relative}`, title: `Install skill file ${entry.relative}`, path: join(target.skillDir, ...entry.relative.split("/")), content: entry.content, adapter: "claude" }))
    ];
    if (context.options.statusline) {
      steps.push(jsoncStep({
        id: "claude.statusline",
        title: "Point the status line at Prumo",
        path: target.settings,
        adapter: "claude",
        mutate: text => setStatusLine(text, ["statusLine"], { type: "command", command: statuslineCommand(context), padding: 0 })
      }));
    }
    if (context.options.userProtocol) {
      steps.push(managedBlockStep({ id: "claude.user-protocol", title: "Attach the Prumo managed block to ~/.claude/CLAUDE.md", path: target.userProtocol, adapter: "claude", artifactText: context.artifacts.get("agents/CLAUDE.md") }));
    }
    return steps;
  },
  planUpdate(context) {
    return this.planInstall(context);
  },
  planUninstall(context, journal) {
    const target = paths(context.home);
    return [
      jsoncStep({ id: "claude.hook", title: "Remove the SessionStart hook", path: target.settings, adapter: "claude", mutate: text => removeGroupedHook(text, ["hooks", "SessionStart"]) }),
      jsoncStep({ id: "claude.statusline", title: "Remove the Prumo status line", path: target.settings, adapter: "claude", mutate: text => unsetStatusLine(text, ["statusLine"]) }),
      ...ownedFiles(journal, "claude", target.skillDir, artifactFiles(context.artifacts, SKILL_PREFIX)).map(file => deleteStep({ id: `claude.skill:${file.relative}`, title: `Remove skill file ${file.relative}`, path: file.path, adapter: "claude", guardHash: file.afterHash })),
      removeManagedBlockStep({ id: "claude.user-protocol", title: "Detach the Prumo managed block from ~/.claude/CLAUDE.md", path: target.userProtocol, adapter: "claude" })
    ];
  },
  verifyInstall(context) {
    const target = paths(context.home);
    const checks = [
      verifyGroupedHook(context, { id: "claude.hook", path: target.settings, eventPath: ["hooks", "SessionStart"], cli: "claude" }),
      verifyOwnedFile("claude.skill", join(target.skillDir, "SKILL.md"), context.artifacts.get(`${SKILL_PREFIX}SKILL.md`))
    ];
    if (context.options.statusline) checks.push(verifyStatusLine(context, target.settings));
    if (context.options.userProtocol) checks.push(verifyManagedBlock("claude.user-protocol", target.userProtocol, context.artifacts.get("agents/CLAUDE.md")));
    return { state: summarizeState(checks, { requiredIds: ["claude.hook", "claude.skill"], optionalIds: ["claude.statusline", "claude.user-protocol"] }), checks };
  },
  diagnose(context) {
    const target = paths(context.home);
    const { checks } = this.verifyInstall(context);
    checks.push(check("claude.config-dir", existsSync(target.root) ? true : "warn", existsSync(target.root) ? target.root : `${target.root} absent (Claude Code not initialised)`));
    return checks;
  }
};

function verifyStatusLine(context, settingsPath) {
  const config = readConfigObject(settingsPath);
  if (config.error) return check("claude.statusline", false, `settings.json does not parse: ${config.error}`);
  const statusLine = config.value?.statusLine;
  if (!statusLine || typeof statusLine !== "object") return check("claude.statusline", false, "no status line configured");
  if (!commandTargets(statusLine.command, context.layout.statuslinePath)) return check("claude.statusline", "warn", "status line is not Prumo (user configuration preserved)");
  return check("claude.statusline", true, "Prumo status line");
}
