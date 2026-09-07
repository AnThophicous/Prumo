import { existsSync } from "node:fs";
import { join } from "node:path";
import { getPath, setPath } from "../config/jsonc.mjs";
import {
  addFlatHook,
  check,
  deleteStep,
  fileStep,
  hookCommand,
  jsoncStep,
  removeFlatHook,
  summarizeState,
  verifyFlatHook,
  verifyOwnedFile
} from "./contract.mjs";

const RULE_ARTIFACT = "agents/cursor-rule.mdc";

function paths(home) {
  const root = join(home, ".cursor");
  return { root, hooks: join(root, "hooks.json"), rule: join(root, "rules", "prumo.mdc") };
}

export const cursorAdapter = {
  id: "cursor",
  label: "Cursor (CLI and app)",
  commands: ["cursor-agent", "cursor"],
  configDirs: home => [paths(home).root],
  capabilities: {
    hooks: { sessionStart: true, postCompact: false },
    persistentRules: "always-on rule",
    skills: false,
    customStatusLine: false,
    projectInstructions: "AGENTS.md",
    userInstructions: "~/.cursor/rules/prumo.mdc"
  },
  planInstall(context) {
    const target = paths(context.home);
    return [
      jsoncStep({
        id: "cursor.hook",
        title: "Register the sessionStart hook",
        path: target.hooks,
        adapter: "cursor",
        mutate(text) {
          let next = text;
          if (getPath(next, ["version"]) === undefined) next = setPath(next, ["version"], 1);
          return addFlatHook(next, ["hooks", "sessionStart"], { type: "command", command: hookCommand(context, "cursor", "session-start"), timeout: 15 });
        }
      }),
      fileStep({ id: "cursor.rule", title: "Install the always-on Prumo rule", path: target.rule, content: context.artifacts.get(RULE_ARTIFACT), adapter: "cursor" })
    ];
  },
  planUpdate(context) {
    return this.planInstall(context);
  },
  planUninstall(context, journal) {
    const target = paths(context.home);
    const recorded = (journal?.targets?.cursor?.mutations ?? []).find(entry => entry.step === "cursor.rule");
    return [
      jsoncStep({ id: "cursor.hook", title: "Remove the sessionStart hook", path: target.hooks, adapter: "cursor", mutate: text => removeFlatHook(text, ["hooks", "sessionStart"]) }),
      deleteStep({ id: "cursor.rule", title: "Remove the Prumo rule", path: target.rule, adapter: "cursor", guardHash: recorded?.afterHash })
    ];
  },
  verifyInstall(context) {
    const target = paths(context.home);
    const checks = [
      verifyFlatHook(context, { id: "cursor.hook", path: target.hooks, eventPath: ["hooks", "sessionStart"], cli: "cursor" }),
      verifyOwnedFile("cursor.rule", target.rule, context.artifacts.get(RULE_ARTIFACT))
    ];
    return { state: summarizeState(checks, { requiredIds: ["cursor.hook", "cursor.rule"] }), checks };
  },
  diagnose(context) {
    const target = paths(context.home);
    const { checks } = this.verifyInstall(context);
    checks.push(check("cursor.config-dir", existsSync(target.root) ? true : "warn", existsSync(target.root) ? target.root : `${target.root} absent (Cursor not initialised)`));
    return checks;
  }
};
