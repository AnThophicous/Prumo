import { join } from "node:path";
import { copyInto, nodeCommand, readJson, writeJson, writeText } from "../fsops.mjs";
import { protocolSource } from "../protocol.mjs";

const MARKER = "prumo-hook.mjs";

const SKILL = `---
name: prumo
description: >
  Prumo operating protocol for coding agents. Load it when the session needs the
  delivery rules: density per round, specification before code, atomic commits,
  self-audit, security gate and the MapSource.md contract. Use for /prumo,
  "apply the protocol" or "what does PRU-xx say".
---

The normative text lives in the protocol file at the project root (CLAUDE.md or
AGENTS.md) and in \`~/.prumo/content/PRUMO.md\`. Rules are cited by id: PRU-01 to
PRU-239.

Bootstrap order for a session: read MapSource.md, read the protocol file, then
the README and build configuration. Update MapSource.md at the end of each block
of work.
`;

export const claudeAdapter = {
  id: "claude",
  label: "Claude Code",
  commands: ["claude"],
  configDirs: home => [join(home, ".claude")],
  capabilities: { hooks: true, statusline: true, protocolFile: "CLAUDE.md", compaction: "SessionStart refires on compact" },
  steps({ home, runtime, options }) {
    const settingsPath = join(home, ".claude", "settings.json");
    const skillPath = join(home, ".claude", "skills", "prumo", "SKILL.md");
    const steps = [
      {
        title: "Register the SessionStart hook",
        path: settingsPath,
        apply() {
          const settings = readJson(settingsPath);
          settings.hooks = settings.hooks ?? {};
          registerHook(settings.hooks, "SessionStart", nodeCommand(runtime.hookPath, ["--cli=claude", "--event=session-start"]));
          writeJson(settingsPath, settings);
        }
      },
      {
        title: "Install the /prumo skill",
        path: skillPath,
        apply() {
          writeText(skillPath, SKILL);
        }
      }
    ];
    if (options.statusline) {
      steps.push({
        title: "Point the status line at Prumo",
        path: settingsPath,
        apply() {
          const settings = readJson(settingsPath);
          settings.statusLine = { type: "command", command: nodeCommand(runtime.statuslinePath), padding: 0 };
          writeJson(settingsPath, settings);
        }
      });
    }
    if (options.userProtocol) {
      const userProtocolPath = join(home, ".claude", "CLAUDE.md");
      steps.push({
        title: "Copy the protocol to the user memory file",
        path: userProtocolPath,
        apply() {
          const source = protocolSource("claude", [runtime.contentDir, runtime.protocolSrcDir]);
          if (source) copyInto(source.path, userProtocolPath);
        }
      });
    }
    return steps;
  }
};

function registerHook(hooks, event, command) {
  hooks[event] = Array.isArray(hooks[event]) ? hooks[event] : [];
  const present = hooks[event].some(group => (group.hooks ?? []).some(entry => typeof entry.command === "string" && entry.command.includes(MARKER)));
  if (present) return;
  hooks[event].push({ hooks: [{ type: "command", command, timeout: 15, statusMessage: "Loading Prumo protocol" }] });
}
