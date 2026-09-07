import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { ADAPTERS, adapterById, commandTargets, install, listBackups, quoteArgument, readJournal, readJsoncObject, readTomlValue, rollback, runTransaction, splitCommand, uninstall, update } from "@prumocode/installer";
import { PrumoError, parseManagedBlock } from "@prumocode/runtime";
import { contextFor, tempHome } from "./helpers.mjs";

const fixtures = [];
function fixture() {
  const created = tempHome();
  fixtures.push(created);
  return created;
}
after(() => fixtures.forEach(entry => entry.cleanup()));

const TARGETS = ["claude", "codex", "cursor", "grok", "gemini"];

test("every adapter implements the contract and declares capabilities", () => {
  for (const adapter of ADAPTERS) {
    for (const method of ["planInstall", "verifyInstall", "planUpdate", "planUninstall", "diagnose"]) assert.equal(typeof adapter[method], "function", `${adapter.id}.${method}`);
    assert.ok(Array.isArray(adapter.commands) && adapter.commands.length > 0);
    assert.equal(typeof adapter.configDirs("/home/x")[0], "string");
    assert.equal(typeof adapter.capabilities.hooks.sessionStart, "boolean");
    assert.ok("projectInstructions" in adapter.capabilities);
  }
  assert.ok(adapterById("gemini"), "gemini is a real target");
});

test("hook commands are semantically correct on both platforms: resolve the runtime script, carry --cli, survive spaces and quotes", () => {
  for (const platform of ["win32", "linux"]) {
    const home = fixture();
    const spaced = join(home.home, "dir with spaces", "and 'quote'");
    const env = { ...home.env, PRUMO_HOME: join(spaced, ".prumo") };
    const context = contextFor({ ...home, env }, { platform, statusline: true });
    for (const adapter of ADAPTERS) {
      const plan = adapter.planInstall(context);
      const commands = [];
      for (const step of plan) {
        const result = step.compute(undefined);
        if (step.kind === "config" || step.id.endsWith(".hook")) {
          const text = result.next ?? "";
          for (const match of text.matchAll(/"command":\s*"((?:[^"\\]|\\.)*)"/g)) commands.push(JSON.parse(`"${match[1]}"`));
          for (const match of text.matchAll(/^command = "((?:[^"\\]|\\.)*)"/gm)) commands.push(JSON.parse(`"${match[1]}"`));
        }
      }
      const hookCommands = commands.filter(command => command.includes("prumo-hook.mjs"));
      assert.ok(hookCommands.length > 0, `${adapter.id} on ${platform} registers no hook command`);
      for (const command of hookCommands) {
        assert.ok(commandTargets(command, context.layout.hookPath), `${adapter.id} ${platform}: ${command} does not resolve ${context.layout.hookPath}`);
        const words = splitCommand(command);
        assert.ok(words.includes(`--cli=${adapter.id}`), `${adapter.id}: missing --cli in ${command}`);
        assert.ok(words.some(word => word.startsWith("--event=")));
        assert.ok(words[1].includes("dir with spaces"), "path with spaces survives");
        assert.ok(words[1].includes("'quote'"), "path with quotes survives");
      }
    }
  }
});

test("quoteArgument round-trips through splitCommand for hostile values", () => {
  for (const platform of ["win32", "linux"]) {
    for (const value of ["plain", "with space", "it's", 'say "hi"', "C:\\Users\\x y\\.prumo\\hook.mjs", "$HOME/`x`"]) {
      const quoted = quoteArgument(value, platform);
      const expected = platform === "win32" ? value.replaceAll("\\", "/") : value;
      assert.deepEqual(splitCommand(quoted), [expected], `${platform}: ${value} -> ${quoted}`);
    }
  }
});

test("install is transactional and idempotent; foreign config is preserved textually", () => {
  const home = fixture();
  home.write(".claude/settings.json", `{\n  // keep me\n  "theme": "dark",\n  "hooks": { "PreToolUse": [{ "hooks": [{ "type": "command", "command": "echo // x" }] }] },\n}\n`);
  home.write(".codex/config.toml", `model = "gpt-5"\r\n\r\n[features]\r\nfoo = true\r\n`);
  home.write(".gemini/GEMINI.md", "# Mine\n\nKeep.\n");
  const context = contextFor(home, { statusline: true, userProtocol: true });
  const first = install(context, { targets: TARGETS });
  assert.equal(first.status, "applied");
  assert.ok(first.plan.changes > 50);
  for (const entry of first.verification) assert.equal(entry.state, "ACTIVE", `${entry.adapter}: ${JSON.stringify(entry.checks)}`);

  const settings = home.read(".claude/settings.json");
  assert.ok(settings.includes("// keep me"));
  assert.equal(readJsoncObject(settings).hooks.PreToolUse[0].hooks[0].command, "echo // x");
  assert.equal(readJsoncObject(settings).hooks.SessionStart.length, 1);
  const toml = home.read(".codex/config.toml");
  assert.ok(toml.includes("\r\n"));
  assert.equal(readTomlValue(toml, "features", "hooks"), "true");
  assert.equal(readTomlValue(toml, "features", "foo"), "true");
  const gemini = home.read(".gemini/GEMINI.md");
  assert.ok(gemini.startsWith("# Mine\n\nKeep.\n"));
  assert.equal(parseManagedBlock(gemini).valid, true);
  assert.ok(existsSync(home.path(".prumo/runtime/hooks/prumo-hook.mjs")));
  assert.ok(existsSync(home.path(".prumo/protocol/protocol.manifest.json")));
  assert.ok(existsSync(home.path(".claude/skills/prumo/references/debugging.md")));

  const journal = readJournal(home.path(".prumo/state/install.json"));
  assert.equal(journal.protocolVersion, context.protocolVersion);
  assert.equal(journal.protocolHash, context.protocolHash);
  for (const target of TARGETS) assert.equal(journal.targets[target].state, "ACTIVE");
  assert.ok(journal.targets.claude.mutations.every(entry => entry.beforeHash !== undefined || entry.afterHash));

  const second = install(contextFor(home, { statusline: true, userProtocol: true }), { targets: TARGETS });
  assert.equal(second.status, "noop");
  assert.equal(second.plan.changes, 0);
  assert.equal(readJsoncObject(home.read(".claude/settings.json")).hooks.SessionStart.length, 1);
  assert.equal(readJsoncObject(home.read(".cursor/hooks.json")).hooks.sessionStart.length, 1);
});

test("a failure in a later step rolls back every earlier step", () => {
  const home = fixture();
  home.write("a.json", `{ "a": 1 }\n`);
  const groups = [
    { adapter: "x", label: "X", steps: [
      { id: "one", title: "one", path: home.path("a.json"), kind: "file", ownership: "prumo-file", compute: () => ({ next: `{ "a": 2 }\n`, changed: true, summary: ["~"] }) },
      { id: "two", title: "two", path: home.path("b.txt"), kind: "file", ownership: "prumo-file", compute: () => ({ next: "new", changed: true, summary: ["+"] }) },
      { id: "three", title: "three", path: home.path("c.txt"), kind: "file", ownership: "prumo-file", compute: () => ({ next: "boom", changed: true, summary: ["+"] }) }
    ], verify: () => ({ state: "BROKEN", checks: [{ id: "x.three", status: "FAIL", detail: "simulated verification failure" }] }) }
  ];
  assert.throws(() => runTransaction({ operation: "install", groups, backupsDir: home.path(".prumo/backups") }), error => error instanceof PrumoError && error.code === "PRUMO_E_TRANSACTION");
  assert.equal(home.read("a.json"), `{ "a": 1 }\n`);
  assert.equal(existsSync(home.path("b.txt")), false);
  assert.equal(existsSync(home.path("c.txt")), false);
});

test("a malformed config stops the transaction before anything is written", () => {
  const home = fixture();
  home.write(".claude/settings.json", `{ "theme": "dark", "hooks": [ }`);
  home.write(".cursor/hooks.json", `{ "version": 1 }\n`);
  const context = contextFor(home, { statusline: true });
  assert.throws(() => install(context, { targets: ["cursor", "claude"] }), error => error.code === "PRUMO_E_CONFIG_PARSE");
  assert.equal(home.read(".claude/settings.json"), `{ "theme": "dark", "hooks": [ }`);
  assert.equal(home.read(".cursor/hooks.json"), `{ "version": 1 }\n`);
  assert.equal(existsSync(home.path(".prumo/runtime")), false);
});

test("uninstall removes only Prumo ownership and keeps foreign content byte-for-byte; runtime goes with --all", () => {
  const home = fixture();
  const originalSettings = `{\n  // mine\n  "theme": "dark",\n  "statusLine": { "type": "command", "command": "my-status" },\n  "hooks": { "PreToolUse": [{ "hooks": [{ "type": "command", "command": "echo hi" }] }] },\n}\n`;
  home.write(".claude/settings.json", originalSettings);
  const originalGemini = "# Mine\n\nKeep this.\n";
  home.write(".gemini/GEMINI.md", originalGemini);
  const originalToml = `[features]\nfoo = true\n`;
  home.write(".codex/config.toml", originalToml);
  install(contextFor(home, { statusline: true, userProtocol: true }), { targets: TARGETS });
  assert.equal(readJsoncObject(home.read(".claude/settings.json")).statusLine.command, "my-status", "foreign status line is not replaced");

  const result = uninstall(contextFor(home), { all: true });
  assert.equal(result.status, "applied");
  assert.equal(home.read(".claude/settings.json"), originalSettings);
  assert.equal(home.read(".gemini/GEMINI.md"), originalGemini);
  assert.equal(home.read(".codex/config.toml"), `[features]\nfoo = true\nhooks = true\n`, "features.hooks stays because other hooks may depend on it");
  assert.equal(existsSync(home.path(".claude/skills/prumo")), false || existsSync(home.path(".claude/skills/prumo/SKILL.md")) === false);
  assert.equal(existsSync(home.path(".claude/CLAUDE.md")), false);
  assert.equal(existsSync(home.path(".cursor/rules/prumo.mdc")), false);
  assert.equal(existsSync(home.path(".grok/hooks/prumo.json")), false);
  assert.equal(existsSync(home.path(".prumo/runtime/hooks/prumo-hook.mjs")), false);
  assert.deepEqual(readJsoncObject(home.read(".cursor/hooks.json")), { version: 1 });
  const journal = readJournal(home.path(".prumo/state/install.json"));
  assert.deepEqual(Object.keys(journal.targets), []);
});

test("uninstall does not delete a Prumo-owned file the user modified; it reports a conflict", () => {
  const home = fixture();
  install(contextFor(home, { statusline: false }), { targets: ["cursor"] });
  writeFileSync(home.path(".cursor/rules/prumo.mdc"), "# my edits\n");
  const result = uninstall(contextFor(home), { targets: ["cursor"] });
  assert.equal(home.read(".cursor/rules/prumo.mdc"), "# my edits\n");
  assert.equal(result.conflicts.length, 1);
  assert.match(result.conflicts[0].reason, /modified outside Prumo/);
});

test("rollback restores the snapshot taken before the last operation", () => {
  const home = fixture();
  const original = `{\n  "theme": "light"\n}\n`;
  home.write(".claude/settings.json", original);
  install(contextFor(home, { statusline: true }), { targets: ["claude"] });
  assert.notEqual(home.read(".claude/settings.json"), original);
  const backups = listBackups(contextFor(home));
  assert.equal(backups.length, 1);
  assert.equal(backups[0].operation, "install");
  const result = rollback(contextFor(home));
  assert.ok(result.restored > 0);
  assert.equal(home.read(".claude/settings.json"), original);
  assert.equal(existsSync(home.path(".claude/skills/prumo/SKILL.md")), false);
  assert.equal(existsSync(home.path(".prumo/runtime/hooks/prumo-hook.mjs")), false);
});

test("update recompiles the protocol, migrates artifacts and reports version comparison", () => {
  const home = fixture();
  install(contextFor(home, { statusline: false }), { targets: ["codex"] });
  const manifestPath = home.path(".prumo/protocol/protocol.manifest.json");
  const stale = JSON.parse(readFileSync(manifestPath, "utf8"));
  stale.sourceHash = "0".repeat(64);
  stale.protocolVersion = "1.9.0";
  writeFileSync(manifestPath, JSON.stringify(stale, null, 2));
  const journalPath = home.path(".prumo/state/install.json");
  const journal = readJournal(journalPath);
  journal.protocolVersion = "1.9.0";
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  const result = update(contextFor(home));
  assert.equal(result.status, "applied");
  assert.equal(result.comparison.protocol.installed, "1.9.0");
  assert.equal(result.comparison.protocol.available, contextFor(home).protocolVersion);
  assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).sourceHash, contextFor(home).protocolHash);
  assert.equal(readJournal(journalPath).protocolVersion, contextFor(home).protocolVersion);
});

test("verifyInstall reports DRIFTED when a Prumo-owned file is edited and ABSENT when nothing is installed", () => {
  const home = fixture();
  const absent = adapterById("cursor").verifyInstall(contextFor(home));
  assert.equal(absent.state, "ABSENT");
  install(contextFor(home), { targets: ["cursor"] });
  writeFileSync(home.path(".cursor/rules/prumo.mdc"), "edited\n");
  const drifted = adapterById("cursor").verifyInstall(contextFor(home));
  assert.equal(drifted.state, "DRIFTED");
});

test("verifyInstall reports BROKEN when the hook is configured but the runtime is missing", () => {
  const home = fixture();
  install(contextFor(home), { targets: ["cursor"] });
  rmSync(home.path(".prumo/runtime/hooks/prumo-hook.mjs"));
  const broken = adapterById("cursor").verifyInstall(contextFor(home));
  assert.equal(broken.state, "BROKEN");
});

test("unknown target and missing arguments fail with typed errors before touching files", () => {
  const home = fixture();
  assert.throws(() => install(contextFor(home), { targets: ["emacs"] }), error => error.code === "PRUMO_E_UNSUPPORTED_VERSION");
  assert.throws(() => uninstall(contextFor(home), {}), error => error.code === "PRUMO_E_UNSUPPORTED_VERSION");
  assert.equal(existsSync(home.path(".prumo")), false);
});
