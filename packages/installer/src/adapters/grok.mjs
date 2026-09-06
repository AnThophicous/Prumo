import { readFileSync } from "node:fs";
import { join } from "node:path";
import { copyInto, nodeCommand, readText, upsertTomlValue, writeJson, writeText } from "../fsops.mjs";
import { protocolSource } from "../protocol.mjs";

export const grokAdapter = {
  id: "grok",
  label: "Grok Build",
  commands: ["grok"],
  configDirs: home => [join(home, ".grok")],
  capabilities: { hooks: true, statusline: true, protocolFile: "AGENTS.md", compaction: "global rule" },
  steps({ home, runtime, options }) {
    const hooksPath = join(home, ".grok", "hooks", "prumo.json");
    const rulePath = join(home, ".grok", "rules", "prumo.md");
    const configPath = join(home, ".grok", "config.toml");
    const hookCommand = event => nodeCommand(runtime.hookPath, ["--cli=grok", `--event=${event}`]);
    const steps = [
      {
        title: "Install the Prumo hook file",
        path: hooksPath,
        apply() {
          writeJson(hooksPath, {
            hooks: {
              SessionStart: [{ hooks: [{ type: "command", command: hookCommand("session-start"), timeout: 15 }] }],
              PostCompact: [{ hooks: [{ type: "command", command: hookCommand("post-compact"), timeout: 15 }] }]
            }
          });
        }
      },
      {
        title: "Install the global Prumo rule",
        path: rulePath,
        apply() {
          const source = protocolSource("grok", [runtime.contentDir]);
          writeText(rulePath, source ? readFileSync(source.path, "utf8") : "");
        }
      }
    ];
    if (options.statusline) {
      steps.push({
        title: "Point the status line at Prumo",
        path: configPath,
        apply() {
          let config = readText(configPath);
          config = upsertTomlValue(config, "ui.status_line", "type", '"command"');
          config = upsertTomlValue(config, "ui.status_line", "command", JSON.stringify(nodeCommand(runtime.statuslinePath)));
          config = upsertTomlValue(config, "ui.status_line", "padding", "0");
          writeText(configPath, config);
        }
      });
    }
    if (options.userProtocol) {
      const userProtocolPath = join(home, ".grok", "AGENTS.md");
      steps.push({
        title: "Copy the protocol to the user instructions file",
        path: userProtocolPath,
        apply() {
          const source = protocolSource("grok", [runtime.contentDir, runtime.protocolSrcDir]);
          if (source) copyInto(source.path, userProtocolPath);
        }
      });
    }
    return steps;
  }
};
