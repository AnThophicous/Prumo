import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readTomlValue, removeTomlKey, upsertTomlValue } from "../config/toml.mjs";
import {
  check,
  commandTargets,
  deleteStep,
  fileStep,
  hookCommand,
  managedBlockStep,
  removeManagedBlockStep,
  statuslineCommand,
  summarizeState,
  tomlStep,
  verifyManagedBlock,
  verifyOwnedFile
} from "./contract.mjs";

const RULE_ARTIFACT = "agents/grok-rule.md";
const STATUS_SECTION = "ui.status_line";

function paths(home) {
  const root = join(home, ".grok");
  return { root, hooks: join(root, "hooks", "prumo.json"), rule: join(root, "rules", "prumo.md"), config: join(root, "config.toml"), userProtocol: join(root, "AGENTS.md") };
}

function hookFile(context) {
  const entry = event => ({ hooks: [{ type: "command", command: hookCommand(context, "grok", event), timeout: 15 }] });
  return `${JSON.stringify({ hooks: { SessionStart: [entry("session-start")], PostCompact: [entry("post-compact")] } }, null, 2)}\n`;
}

export const grokAdapter = {
  id: "grok",
  label: "Grok Build",
  commands: ["grok"],
  configDirs: home => [paths(home).root],
  capabilities: {
    hooks: { sessionStart: true, postCompact: true },
    persistentRules: "global rule",
    skills: false,
    customStatusLine: true,
    projectInstructions: "AGENTS.md",
    userInstructions: "~/.grok/AGENTS.md"
  },
  planInstall(context) {
    const target = paths(context.home);
    const steps = [
      fileStep({ id: "grok.hook", title: "Install the Prumo hook file", path: target.hooks, content: hookFile(context), adapter: "grok" }),
      fileStep({ id: "grok.rule", title: "Install the global Prumo rule", path: target.rule, content: context.artifacts.get(RULE_ARTIFACT), adapter: "grok" })
    ];
    if (context.options.statusline) {
      const command = statuslineCommand(context);
      steps.push(tomlStep({
        id: "grok.statusline",
        title: "Point the status line at Prumo",
        path: target.config,
        adapter: "grok",
        describe: "+ [ui.status_line] command",
        mutate(text) {
          const existing = readTomlValue(text, STATUS_SECTION, "command");
          if (existing !== undefined && !existing.includes("prumo-statusline.mjs")) return { text, summary: ["= status line already set by the user (preserved)"] };
          let next = upsertTomlValue(text, STATUS_SECTION, "type", '"command"');
          next = upsertTomlValue(next, STATUS_SECTION, "command", JSON.stringify(command));
          next = upsertTomlValue(next, STATUS_SECTION, "padding", "0");
          return { text: next };
        }
      }));
    }
    if (context.options.userProtocol) {
      steps.push(managedBlockStep({ id: "grok.user-protocol", title: "Attach the Prumo managed block to ~/.grok/AGENTS.md", path: target.userProtocol, adapter: "grok", artifactText: context.artifacts.get("agents/AGENTS.md") }));
    }
    return steps;
  },
  planUpdate(context) {
    return this.planInstall(context);
  },
  planUninstall(context, journal) {
    const target = paths(context.home);
    const recorded = id => (journal?.targets?.grok?.mutations ?? []).find(entry => entry.step === id);
    return [
      deleteStep({ id: "grok.hook", title: "Remove the Prumo hook file", path: target.hooks, adapter: "grok", guardHash: recorded("grok.hook")?.afterHash }),
      deleteStep({ id: "grok.rule", title: "Remove the global Prumo rule", path: target.rule, adapter: "grok", guardHash: recorded("grok.rule")?.afterHash }),
      tomlStep({
        id: "grok.statusline",
        title: "Remove the Prumo status line",
        path: target.config,
        adapter: "grok",
        describe: "- [ui.status_line]",
        mutate(text) {
          const existing = readTomlValue(text, STATUS_SECTION, "command");
          if (existing === undefined || !existing.includes("prumo-statusline.mjs")) return { text, summary: ["= status line not owned by Prumo"] };
          let next = removeTomlKey(text, STATUS_SECTION, "command", { removeEmptySection: false }).text;
          next = removeTomlKey(next, STATUS_SECTION, "type", { removeEmptySection: false }).text;
          next = removeTomlKey(next, STATUS_SECTION, "padding").text;
          return { text: next };
        }
      }),
      removeManagedBlockStep({ id: "grok.user-protocol", title: "Detach the Prumo managed block from ~/.grok/AGENTS.md", path: target.userProtocol, adapter: "grok" })
    ];
  },
  verifyInstall(context) {
    const target = paths(context.home);
    const checks = [verifyHookFile(context, target.hooks), verifyOwnedFile("grok.rule", target.rule, context.artifacts.get(RULE_ARTIFACT))];
    if (context.options.statusline) {
      const value = existsSync(target.config) ? readTomlValue(readFileSync(target.config, "utf8"), STATUS_SECTION, "command") : undefined;
      checks.push(value === undefined ? check("grok.statusline", false, "no status line command") : value.includes("prumo-statusline.mjs") ? check("grok.statusline", true, "Prumo status line") : check("grok.statusline", "warn", "status line is not Prumo (user configuration preserved)"));
    }
    if (context.options.userProtocol) checks.push(verifyManagedBlock("grok.user-protocol", target.userProtocol, context.artifacts.get("agents/AGENTS.md")));
    return { state: summarizeState(checks, { requiredIds: ["grok.hook", "grok.rule"], optionalIds: ["grok.statusline", "grok.user-protocol"] }), checks };
  },
  diagnose(context) {
    const target = paths(context.home);
    const { checks } = this.verifyInstall(context);
    checks.push(check("grok.config-dir", existsSync(target.root) ? true : "warn", existsSync(target.root) ? target.root : `${target.root} absent (Grok Build not initialised)`));
    return checks;
  }
};

function verifyHookFile(context, path) {
  if (!existsSync(path)) return check("grok.hook", false, `${path} missing`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { ...check("grok.hook", false, `hook file does not parse: ${error instanceof Error ? error.message : String(error)}`), broken: true };
  }
  const commands = Object.values(parsed?.hooks ?? {}).flat().flatMap(group => group?.hooks ?? []).map(entry => entry?.command);
  if (commands.length === 0) return { ...check("grok.hook", false, "hook file has no commands"), drift: true };
  if (!commands.every(command => commandTargets(command, context.layout.hookPath))) return { ...check("grok.hook", false, `hook commands do not resolve to ${context.layout.hookPath}`), drift: true };
  if (!existsSync(context.layout.hookPath)) return { ...check("grok.hook", false, `runtime hook missing at ${context.layout.hookPath}`), broken: true };
  return check("grok.hook", true, "SessionStart and PostCompact reachable");
}
