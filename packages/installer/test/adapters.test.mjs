import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPlan, planInstall } from "../src/install.mjs";

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), "prumo-home-"));
  const runtime = mkdtempSync(join(tmpdir(), "prumo-runtime-"));
  return { home, runtime, env: { PRUMO_HOME: runtime } };
}

function cleanup({ home, runtime }) {
  rmSync(home, { recursive: true, force: true });
  rmSync(runtime, { recursive: true, force: true });
}

test("the runtime install copies the protocol, the hook and the status line", () => {
  const box = sandbox();
  try {
    const { plan } = planInstall([], {}, box.env, box.home);
    applyPlan(plan);
    assert.equal(existsSync(join(box.runtime, "content", "AGENTS.md")), true);
    assert.equal(existsSync(join(box.runtime, "content", "CLAUDE.md")), true);
    assert.equal(existsSync(join(box.runtime, "hooks", "prumo-hook.mjs")), true);
    assert.equal(existsSync(join(box.runtime, "statusline", "prumo-statusline.mjs")), true);
    assert.equal(existsSync(join(box.runtime, "src", "protocol.mjs")), true);
  } finally {
    cleanup(box);
  }
});

test("Claude Code gets hooks, the skill and the status line", () => {
  const box = sandbox();
  try {
    const { plan } = planInstall(["claude"], { statusline: true }, box.env, box.home);
    applyPlan(plan);
    const settings = JSON.parse(readFileSync(join(box.home, ".claude", "settings.json"), "utf8"));
    assert.equal(settings.hooks.SessionStart.length, 1);
    assert.match(settings.hooks.SessionStart[0].hooks[0].command, /prumo-hook\.mjs" "--cli=claude" "--event=session-start"/);
    assert.equal(settings.hooks.PostCompact, undefined);
    assert.match(settings.statusLine.command, /prumo-statusline\.mjs/);
    if (process.platform === "win32") assert.doesNotMatch(settings.statusLine.command, /\\/);
    assert.equal(existsSync(join(box.home, ".claude", "skills", "prumo", "SKILL.md")), true);
  } finally {
    cleanup(box);
  }
});

test("installing twice does not duplicate a hook and keeps foreign settings", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.home, ".claude"), { recursive: true });
    writeFileSync(join(box.home, ".claude", "settings.json"), JSON.stringify({ theme: "dark", hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo other" }] }] } }));
    const first = planInstall(["claude"], {}, box.env, box.home);
    applyPlan(first.plan);
    const second = planInstall(["claude"], {}, box.env, box.home);
    applyPlan(second.plan);
    const settings = JSON.parse(readFileSync(join(box.home, ".claude", "settings.json"), "utf8"));
    assert.equal(settings.theme, "dark");
    assert.equal(settings.hooks.SessionStart.length, 2);
    assert.equal(settings.hooks.SessionStart[0].hooks[0].command, "echo other");
    assert.equal(existsSync(join(box.home, ".claude", "settings.json.prumo-backup")), true);
  } finally {
    cleanup(box);
  }
});

test("Codex gets hooks.json, the feature flag and the status line order", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.home, ".codex"), { recursive: true });
    writeFileSync(join(box.home, ".codex", "config.toml"), '[model]\nname = "gpt-5"\n');
    const { plan } = planInstall(["codex"], { statusline: true }, box.env, box.home);
    applyPlan(plan);
    const hooks = JSON.parse(readFileSync(join(box.home, ".codex", "hooks.json"), "utf8"));
    assert.match(hooks.hooks.SessionStart[0].hooks[0].command, /--cli=codex/);
    assert.equal(hooks.hooks.PostCompact, undefined);
    const config = readFileSync(join(box.home, ".codex", "config.toml"), "utf8");
    assert.match(config, /\[model\]\nname = "gpt-5"/);
    assert.match(config, /\[features\]\nhooks = true/);
    assert.match(config, /status_line = \["model-with-reasoning", "context-remaining"/);
  } finally {
    cleanup(box);
  }
});

test("Cursor gets a session hook and an always-on rule without unsupported config", () => {
  const box = sandbox();
  try {
    const { plan } = planInstall(["cursor"], { statusline: true }, box.env, box.home);
    applyPlan(plan);
    const hooks = JSON.parse(readFileSync(join(box.home, ".cursor", "hooks.json"), "utf8"));
    assert.equal(hooks.version, 1);
    assert.match(hooks.hooks.sessionStart[0].command, /"--cli=cursor" "--event=session-start"/);
    assert.equal(hooks.hooks.preCompact, undefined);
    const rule = readFileSync(join(box.home, ".cursor", "rules", "prumo.mdc"), "utf8");
    assert.match(rule, /alwaysApply: true/);
    assert.match(rule, /PRU-01/);
    assert.equal(existsSync(join(box.home, ".cursor", "cli-config.json")), false);
  } finally {
    cleanup(box);
  }
});

test("Grok gets hooks, a global rule and its command status line", () => {
  const box = sandbox();
  try {
    const { plan } = planInstall(["grok"], { statusline: true, userProtocol: true }, box.env, box.home);
    const results = applyPlan(plan);
    const hooks = JSON.parse(readFileSync(join(box.home, ".grok", "hooks", "prumo.json"), "utf8"));
    assert.match(hooks.hooks.SessionStart[0].hooks[0].command, /--cli=grok/);
    assert.match(hooks.hooks.PostCompact[0].hooks[0].command, /--event=post-compact/);
    assert.match(readFileSync(join(box.home, ".grok", "rules", "prumo.md"), "utf8"), /PRU-01/);
    const config = readFileSync(join(box.home, ".grok", "config.toml"), "utf8");
    assert.match(config, /\[ui\.status_line\]/);
    assert.match(config, /type = "command"/);
    assert.match(config, /command = "node \\".*prumo-statusline\.mjs\\""/);
    assert.match(config, /padding = 0/);
    assert.equal(existsSync(join(box.home, ".grok", "AGENTS.md")), true);
    assert.equal(results.filter(record => record.target === "grok").some(record => record.title.includes("status line")), true);
  } finally {
    cleanup(box);
  }
});

test("malformed existing JSON fails without replacing user configuration", () => {
  const box = sandbox();
  try {
    const settingsPath = join(box.home, ".claude", "settings.json");
    mkdirSync(join(box.home, ".claude"), { recursive: true });
    writeFileSync(settingsPath, "{ broken");
    const { plan } = planInstall(["claude"], {}, box.env, box.home);
    const results = applyPlan(plan);
    const hookStep = results.find(record => record.target === "claude" && record.title.includes("SessionStart"));
    assert.equal(hookStep.status, "failed");
    assert.match(hookStep.error, /Cannot parse/);
    assert.equal(readFileSync(settingsPath, "utf8"), "{ broken");
  } finally {
    cleanup(box);
  }
});

test("a dry run reports every step and writes nothing", () => {
  const box = sandbox();
  try {
    const { plan } = planInstall(["claude", "codex", "cursor", "grok"], {}, box.env, box.home);
    const results = applyPlan(plan, { dryRun: true });
    assert.equal(results.length > 8, true);
    assert.equal(results.every(record => record.status === "planned"), true);
    assert.equal(existsSync(join(box.home, ".claude")), false);
    assert.equal(existsSync(join(box.runtime, "content")), false);
  } finally {
    cleanup(box);
  }
});
