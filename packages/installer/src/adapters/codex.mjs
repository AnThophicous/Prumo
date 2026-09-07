import { existsSync } from "node:fs";
import { join } from "node:path";
import { removeTomlKey, upsertTomlValue } from "../config/toml.mjs";
import {
  addGroupedHook,
  check,
  hookCommand,
  jsoncStep,
  managedBlockStep,
  removeGroupedHook,
  removeManagedBlockStep,
  summarizeState,
  tomlStep,
  verifyGroupedHook,
  verifyManagedBlock,
  verifyTomlValue
} from "./contract.mjs";

const STATUS_ITEMS = '["model-with-reasoning", "context-remaining", "current-dir", "git-branch"]';

function paths(home) {
  const root = join(home, ".codex");
  return { root, hooks: join(root, "hooks.json"), config: join(root, "config.toml"), userProtocol: join(root, "AGENTS.md") };
}

export const codexAdapter = {
  id: "codex",
  label: "Codex CLI",
  commands: ["codex"],
  configDirs: home => [paths(home).root],
  capabilities: {
    hooks: { sessionStart: true, postCompact: "SessionStart refires on compact" },
    persistentRules: true,
    skills: false,
    customStatusLine: "built-in items only",
    projectInstructions: "AGENTS.md",
    userInstructions: "~/.codex/AGENTS.md"
  },
  planInstall(context) {
    const target = paths(context.home);
    const steps = [
      jsoncStep({
        id: "codex.hook",
        title: "Register the SessionStart hook",
        path: target.hooks,
        adapter: "codex",
        mutate: text => addGroupedHook(text, ["hooks", "SessionStart"], { type: "command", command: hookCommand(context, "codex", "session-start"), timeout: 15 })
      }),
      tomlStep({
        id: "codex.features",
        title: "Enable the hooks feature flag",
        path: target.config,
        adapter: "codex",
        describe: "+ [features] hooks = true",
        mutate: text => ({ text: upsertTomlValue(text, "features", "hooks", "true") })
      })
    ];
    if (context.options.statusline) {
      steps.push(tomlStep({
        id: "codex.statusline",
        title: "Order the built-in status line items",
        path: target.config,
        adapter: "codex",
        describe: "+ [tui] status_line",
        mutate: text => ({ text: upsertTomlValue(text, "tui", "status_line", STATUS_ITEMS) })
      }));
    }
    if (context.options.userProtocol) {
      steps.push(managedBlockStep({ id: "codex.user-protocol", title: "Attach the Prumo managed block to ~/.codex/AGENTS.md", path: target.userProtocol, adapter: "codex", artifactText: context.artifacts.get("agents/AGENTS.md") }));
    }
    return steps;
  },
  planUpdate(context) {
    return this.planInstall(context);
  },
  planUninstall(context, journal) {
    const target = paths(context.home);
    const journalled = new Set((journal?.targets?.codex?.mutations ?? []).map(entry => entry.step));
    const steps = [
      jsoncStep({ id: "codex.hook", title: "Remove the SessionStart hook", path: target.hooks, adapter: "codex", mutate: text => removeGroupedHook(text, ["hooks", "SessionStart"]) })
    ];
    if (journalled.has("codex.statusline")) {
      steps.push(tomlStep({ id: "codex.statusline", title: "Remove the Prumo status line ordering", path: target.config, adapter: "codex", describe: "- [tui] status_line", mutate: text => ({ text: removeTomlKey(text, "tui", "status_line").text }) }));
    }
    steps.push(removeManagedBlockStep({ id: "codex.user-protocol", title: "Detach the Prumo managed block from ~/.codex/AGENTS.md", path: target.userProtocol, adapter: "codex" }));
    return steps;
  },
  verifyInstall(context) {
    const target = paths(context.home);
    const checks = [
      verifyGroupedHook(context, { id: "codex.hook", path: target.hooks, eventPath: ["hooks", "SessionStart"], cli: "codex" }),
      verifyTomlValue("codex.features", target.config, "features", "hooks", "true")
    ];
    if (context.options.statusline) checks.push(verifyTomlValue("codex.statusline", target.config, "tui", "status_line"));
    if (context.options.userProtocol) checks.push(verifyManagedBlock("codex.user-protocol", target.userProtocol, context.artifacts.get("agents/AGENTS.md")));
    return { state: summarizeState(checks, { requiredIds: ["codex.hook", "codex.features"], optionalIds: ["codex.statusline", "codex.user-protocol"] }), checks };
  },
  diagnose(context) {
    const target = paths(context.home);
    const { checks } = this.verifyInstall(context);
    checks.push(check("codex.config-dir", existsSync(target.root) ? true : "warn", existsSync(target.root) ? target.root : `${target.root} absent (Codex CLI not initialised)`));
    return checks;
  }
};
