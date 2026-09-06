import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandExists, detectAll, detectTarget } from "../src/detect.mjs";
import { ADAPTERS, adapterById } from "../src/install.mjs";

function sandbox() {
  return mkdtempSync(join(tmpdir(), "prumo-detect-"));
}

test("commandExists finds an executable on PATH", () => {
  const root = sandbox();
  try {
    const binary = process.platform === "win32" ? "claude.cmd" : "claude";
    writeFileSync(join(root, binary), "");
    assert.equal(commandExists("claude", { PATH: root, PATHEXT: ".CMD;.EXE" }), true);
    assert.equal(commandExists("codex", { PATH: root, PATHEXT: ".CMD;.EXE" }), false);
    assert.equal(commandExists("claude", { PATH: "" }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a config directory is enough evidence when the command is absent", () => {
  const home = sandbox();
  try {
    mkdirSync(join(home, ".grok"), { recursive: true });
    const target = detectTarget(adapterById("grok"), { PATH: "" }, home);
    assert.equal(target.installed, true);
    assert.equal(target.evidence, "config directory");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("detection reports every adapter with its capabilities", () => {
  const home = sandbox();
  try {
    const targets = detectAll(ADAPTERS, { PATH: "" }, home);
    assert.deepEqual(targets.map(target => target.id), ["claude", "codex", "cursor", "grok"]);
    assert.equal(targets.every(target => target.installed === false), true);
    assert.equal(targets[0].capabilities.statusline, true);
    assert.equal(targets[2].capabilities.statusline, false);
    assert.equal(targets[3].capabilities.statusline, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
