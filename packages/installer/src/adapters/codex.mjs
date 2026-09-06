import { join } from "node:path";
import { copyInto, nodeCommand, readJson, readText, upsertTomlValue, writeJson, writeText } from "../fsops.mjs";
import { protocolSource } from "../protocol.mjs";

const MARKER = "prumo-hook.mjs";
const STATUS_ITEMS = '["model-with-reasoning", "context-remaining", "current-dir", "git-branch"]';

export const codexAdapter = {
  id: "codex",
  label: "Codex CLI",
  commands: ["codex"],
  configDirs: home => [join(home, ".codex")],
  capabilities: { hooks: true, statusline: "built-in items only", protocolFile: "AGENTS.md", compaction: "SessionStart refires on compact" },
  steps({ home, runtime, options }) {
    const hooksPath = join(home, ".codex", "hooks.json");
    const configPath = join(home, ".codex", "config.toml");
    const steps = [
      {
        title: "Register the SessionStart hook",
        path: hooksPath,
        apply() {
          const hooks = readJson(hooksPath, { hooks: {} });
          hooks.hooks = hooks.hooks ?? {};
          registerHook(hooks.hooks, "SessionStart", nodeCommand(runtime.hookPath, ["--cli=codex", "--event=session-start"]));
          writeJson(hooksPath, hooks);
        }
      },
      {
        title: "Enable the hooks feature flag",
        path: configPath,
        apply() {
          const current = readText(configPath);
          writeText(configPath, upsertTomlValue(current, "features", "hooks", "true"));
        }
      }
    ];
    if (options.statusline) {
      steps.push({
        title: "Order the built-in status line items",
        path: configPath,
        apply() {
          const current = readText(configPath);
          writeText(configPath, upsertTomlValue(current, "tui", "status_line", STATUS_ITEMS));
        }
      });
    }
    if (options.userProtocol) {
      const userProtocolPath = join(home, ".codex", "AGENTS.md");
      steps.push({
        title: "Copy the protocol to the user instructions file",
        path: userProtocolPath,
        apply() {
          const source = protocolSource("codex", [runtime.contentDir, runtime.protocolSrcDir]);
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
  hooks[event].push({ hooks: [{ type: "command", command, timeout: 15 }] });
}
