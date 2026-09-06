import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlexLayoutEngine, createSlateApp, renderTreeToAnsi, resolveTree, setTheme } from "@slate-terminal/react";
import { createInstallerModel, THEME } from "../src/ui/model.mjs";
import { parseInput } from "../src/ui/input.mjs";

const VIEWPORT = { width: 100, height: 34 };

const TARGETS = [
  { id: "claude", label: "Claude Code", installed: true, evidence: "command on PATH", capabilities: { hooks: true, statusline: true, protocolFile: "CLAUDE.md" } },
  { id: "codex", label: "Codex CLI", installed: true, evidence: "config directory", capabilities: { hooks: true, statusline: "built-in items only", protocolFile: "AGENTS.md" } },
  { id: "cursor", label: "Cursor (CLI and app)", installed: false, evidence: "not found", capabilities: { hooks: true, statusline: false, protocolFile: "AGENTS.md" } },
  { id: "grok", label: "Grok Build", installed: false, evidence: "not found", capabilities: { hooks: true, statusline: true, protocolFile: "AGENTS.md" } }
];

function frame(model) {
  const tree = resolveTree(model.view());
  const layout = createFlexLayoutEngine().layout(tree, VIEWPORT);
  const raw = renderTreeToAnsi(tree, layout, VIEWPORT, { colors: "none" });
  return raw.split(String.fromCharCode(27)).map((part, position) => position === 0 ? part : part.replace(/^[[0-9;]*m/, "")).join("");
}

test("the first screen lists every agent, its evidence and the options", () => {
  setTheme(THEME);
  const model = createInstallerModel(TARGETS);
  const screen = frame(model);
  assert.match(screen, /Prumo\s+installer/);
  assert.match(screen, /Agents on this machine/);
  assert.match(screen, /● Claude Code/);
  assert.match(screen, /● Codex CLI/);
  assert.match(screen, /· Cursor/);
  assert.match(screen, /· Grok Build/);
  assert.match(screen, /command on PATH/);
  assert.match(screen, /Configure the status line/);
  assert.match(screen, /space toggle/);
});

test("keyboard moves the cursor and toggles only what is installed", () => {
  const model = createInstallerModel(TARGETS);
  assert.deepEqual(model.selected.peek(), ["claude", "codex"]);
  model.handleKey({ kind: "key", code: "Space" });
  assert.deepEqual(model.selected.peek(), ["codex"]);
  model.handleKey({ kind: "key", code: "ArrowDown" });
  model.handleKey({ kind: "key", code: "Space" });
  assert.deepEqual(model.selected.peek(), []);
  model.handleKey({ kind: "key", code: "ArrowUp" });
  model.handleKey({ kind: "key", code: "Space" });
  assert.deepEqual(model.selected.peek(), ["claude"]);
  model.toggle(2);
  assert.deepEqual(model.selected.peek(), ["claude"]);
});

test("options toggle from the keyboard", () => {
  const model = createInstallerModel(TARGETS);
  assert.equal(model.options.peek().statusline, true);
  model.handleKey({ kind: "key", code: "ArrowDown" });
  model.handleKey({ kind: "key", code: "ArrowDown" });
  model.handleKey({ kind: "key", code: "Space" });
  assert.equal(model.options.peek().statusline, false);
});

test("a mouse press on a row toggles it through the layout hit-test", () => {
  setTheme(THEME);
  const model = createInstallerModel(TARGETS);
  const app = createSlateApp(model.view, { viewport: VIEWPORT });
  app.mount();
  const row = app.getLayoutNode("agent:codex");
  assert.ok(row, "the codex row has a layout box");
  const result = app.dispatch({ kind: "mouse", action: "press", button: "left", x: row.layout.x + 1, y: row.layout.y });
  assert.equal(result, "render");
  assert.deepEqual(model.selected.peek(), ["claude"]);
  app.close();
});

test("enter runs the plan and the progress screen reports every step", () => {
  const home = mkdtempSync(join(tmpdir(), "prumo-ui-home-"));
  const runtime = mkdtempSync(join(tmpdir(), "prumo-ui-runtime-"));
  try {
    const model = createInstallerModel(TARGETS, { dryRun: true }, { env: { PRUMO_HOME: runtime }, home });
    model.start(callback => callback());
    assert.equal(model.phase.peek(), "done");
    assert.equal(model.results.peek().length > 0, true);
    assert.equal(model.results.peek().every(record => record.status === "planned"), true);
    const screen = frame(model);
    assert.match(screen, /Finished/);
    assert.match(screen, /steps/);
    assert.equal(existsSync(join(runtime, "content")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(runtime, { recursive: true, force: true });
  }
});

test("the input parser reads arrows, space, enter, mouse and Ctrl+C", () => {
  assert.deepEqual(parseInput("\u001b[A"), [{ kind: "key", code: "ArrowUp" }]);
  assert.deepEqual(parseInput("\u001b[B"), [{ kind: "key", code: "ArrowDown" }]);
  assert.deepEqual(parseInput("\r"), [{ kind: "key", code: "Enter" }]);
  assert.deepEqual(parseInput(" "), [{ kind: "key", code: "Space", text: " " }]);
  assert.deepEqual(parseInput(""), [{ kind: "key", code: "c", modifiers: 2 }]);
  assert.deepEqual(parseInput("\u001b[<0;12;5M"), [{ kind: "mouse", action: "press", button: "left", x: 11, y: 4 }]);
  assert.deepEqual(parseInput("\u001b[<0;12;5m"), [{ kind: "mouse", action: "release", button: "left", x: 11, y: 4 }]);
  assert.deepEqual(parseInput("\u001b[<64;3;3M"), [{ kind: "mouse", action: "scroll", x: 2, y: 2, deltaY: -1, button: "middle" }]);
  assert.deepEqual(parseInput("\u001b[<35;9;9M"), [{ kind: "mouse", action: "drag", button: "right", x: 8, y: 8 }]);
});

test("Ctrl+C exits the installer model", () => {
  const model = createInstallerModel(TARGETS);
  let exited = false;
  const result = model.handleKey({ kind: "key", code: "c", modifiers: 2 }, () => { exited = true; });
  assert.equal(result, "consumed");
  assert.equal(exited, true);
});
