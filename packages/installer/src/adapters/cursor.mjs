import { join } from "node:path";
import { readFileSync } from "node:fs";
import { nodeCommand, readJson, writeJson, writeText } from "../fsops.mjs";
import { protocolSource } from "../protocol.mjs";

const MARKER = "prumo-hook.mjs";

export const cursorAdapter = {
  id: "cursor",
  label: "Cursor (CLI and app)",
  commands: ["cursor-agent", "cursor"],
  configDirs: home => [join(home, ".cursor")],
  capabilities: { hooks: true, statusline: false, protocolFile: "AGENTS.md", compaction: "always-on rule" },
  steps({ home, runtime }) {
    const hooksPath = join(home, ".cursor", "hooks.json");
    const rulePath = join(home, ".cursor", "rules", "prumo.mdc");
    return [
      {
        title: "Register the sessionStart hook",
        path: hooksPath,
        apply() {
          const config = readJson(hooksPath, { version: 1, hooks: {} });
          config.version = config.version ?? 1;
          config.hooks = config.hooks ?? {};
          registerHook(config.hooks, "sessionStart", nodeCommand(runtime.hookPath, ["--cli=cursor", "--event=session-start"]));
          writeJson(hooksPath, config);
        }
      },
      {
        title: "Install the always-on Prumo rule",
        path: rulePath,
        apply() {
          const source = protocolSource("cursor", [runtime.contentDir]);
          const body = source ? readFileSync(source.path, "utf8") : "";
          writeText(rulePath, `---\ndescription: Prumo operating protocol\nalwaysApply: true\n---\n\n${body}`);
        }
      }
    ];
  }
};

function registerHook(hooks, event, command) {
  hooks[event] = Array.isArray(hooks[event]) ? hooks[event] : [];
  const present = hooks[event].some(entry => typeof entry.command === "string" && entry.command.includes(MARKER));
  if (present) return;
  hooks[event].push({ type: "command", command, timeout: 15 });
}
