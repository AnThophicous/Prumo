import { existsSync } from "node:fs";
import { join } from "node:path";
import { getPath, setPath } from "../config/jsonc.mjs";
import {
  addGroupedHook,
  check,
  hookCommand,
  jsoncStep,
  managedBlockStep,
  removeGroupedHook,
  removeManagedBlockStep,
  summarizeState,
  verifyGroupedHook,
  verifyManagedBlock
} from "./contract.mjs";

function paths(home) {
  const root = join(home, ".gemini");
  return { root, settings: join(root, "settings.json"), userProtocol: join(root, "GEMINI.md") };
}

export const geminiAdapter = {
  id: "gemini",
  label: "Gemini CLI",
  commands: ["gemini"],
  configDirs: home => [paths(home).root],
  capabilities: {
    hooks: { sessionStart: true, postCompact: false },
    persistentRules: true,
    skills: false,
    customStatusLine: false,
    projectInstructions: "GEMINI.md",
    userInstructions: "~/.gemini/GEMINI.md"
  },
  planInstall(context) {
    const target = paths(context.home);
    const steps = [
      jsoncStep({
        id: "gemini.hook",
        title: "Register the SessionStart hook",
        path: target.settings,
        adapter: "gemini",
        mutate(text) {
          let next = text;
          const summary = [];
          if (getPath(next, ["hooksConfig", "enabled"]) !== true) {
            next = setPath(next, ["hooksConfig", "enabled"], true);
            summary.push("+ hooksConfig.enabled = true");
          }
          const result = addGroupedHook(next, ["hooks", "SessionStart"], { name: "prumo", type: "command", command: hookCommand(context, "gemini", "session-start"), timeout: 15000 });
          return { text: result.text, summary: [...summary, ...result.summary] };
        }
      })
    ];
    if (context.options.userProtocol) {
      steps.push(managedBlockStep({ id: "gemini.user-protocol", title: "Attach the Prumo managed block to ~/.gemini/GEMINI.md", path: target.userProtocol, adapter: "gemini", artifactText: context.artifacts.get("agents/GEMINI.md") }));
    }
    return steps;
  },
  planUpdate(context) {
    return this.planInstall(context);
  },
  planUninstall(context) {
    const target = paths(context.home);
    return [
      jsoncStep({ id: "gemini.hook", title: "Remove the SessionStart hook", path: target.settings, adapter: "gemini", mutate: text => removeGroupedHook(text, ["hooks", "SessionStart"]) }),
      removeManagedBlockStep({ id: "gemini.user-protocol", title: "Detach the Prumo managed block from ~/.gemini/GEMINI.md", path: target.userProtocol, adapter: "gemini" })
    ];
  },
  verifyInstall(context) {
    const target = paths(context.home);
    const checks = [verifyGroupedHook(context, { id: "gemini.hook", path: target.settings, eventPath: ["hooks", "SessionStart"], cli: "gemini" })];
    if (context.options.userProtocol) checks.push(verifyManagedBlock("gemini.user-protocol", target.userProtocol, context.artifacts.get("agents/GEMINI.md")));
    return { state: summarizeState(checks, { requiredIds: ["gemini.hook"], optionalIds: ["gemini.user-protocol"] }), checks };
  },
  diagnose(context) {
    const target = paths(context.home);
    const { checks } = this.verifyInstall(context);
    checks.push(check("gemini.config-dir", existsSync(target.root) ? true : "warn", existsSync(target.root) ? target.root : `${target.root} absent (Gemini CLI not initialised)`));
    return checks;
  }
};
