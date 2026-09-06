import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContext, claudeEventName, hookPayload, protocolFileFor, resolveWorkspace, seedProtocol } from "../src/protocol.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const hook = join(here, "..", "hooks", "prumo-hook.mjs");
const contentDir = join(here, "..", "..", "..", "content");

function workspace() {
  return mkdtempSync(join(tmpdir(), "prumo-workspace-"));
}

function runHook(payload, args, env = {}) {
  return execFileSync(process.execPath, [hook, ...args], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

test("the workspace comes from whichever field the CLI sends", () => {
  assert.equal(resolveWorkspace({ workspace: { current_dir: "/a" } }, {}, "/fallback"), "/a");
  assert.equal(resolveWorkspace({ workspace_roots: ["/b"] }, {}, "/fallback"), "/b");
  assert.equal(resolveWorkspace({ workspaceRoot: "/c" }, {}, "/fallback"), "/c");
  assert.equal(resolveWorkspace({ cwd: "/d" }, {}, "/fallback"), "/d");
  assert.equal(resolveWorkspace({}, {}, "/fallback"), "/fallback");
});

test("each CLI gets the file name it actually reads", () => {
  assert.equal(protocolFileFor("claude"), "CLAUDE.md");
  assert.equal(protocolFileFor("codex"), "AGENTS.md");
  assert.equal(protocolFileFor("cursor"), "AGENTS.md");
  assert.equal(protocolFileFor("grok"), "AGENTS.md");
  assert.equal(protocolFileFor("unknown"), "AGENTS.md");
});

test("seeding writes the protocol once and never overwrites", () => {
  const root = workspace();
  try {
    const first = seedProtocol(root, "codex", [contentDir]);
    assert.equal(first.written, true);
    assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8").includes("PRU-01"), true);
    const second = seedProtocol(root, "codex", [contentDir]);
    assert.equal(second.written, false);
    assert.equal(second.present, true);
    writeFileSync(join(root, "AGENTS.md"), "mine");
    seedProtocol(root, "codex", [contentDir]);
    assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), "mine");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the payload shape matches each CLI contract", () => {
  const context = buildContext({ written: true, present: true, file: "AGENTS.md" }, "/repo", "codex");
  assert.equal(claudeEventName("post-compact"), "PostCompact");
  assert.equal(claudeEventName("prompt"), "UserPromptSubmit");
  assert.equal(claudeEventName("session-start"), "SessionStart");
  const claude = JSON.parse(hookPayload("claude", "session-start", context));
  assert.equal(claude.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(claude.hookSpecificOutput.additionalContext, /PRUMO PROTOCOL ACTIVE/);
  const cursor = JSON.parse(hookPayload("cursor", "session-start", context));
  assert.match(cursor.additional_context, /PRUMO PROTOCOL ACTIVE/);
  assert.equal(hookPayload("grok", "session-start", context), "");
});

test("the hook seeds the project and answers Claude with additionalContext", () => {
  const root = workspace();
  try {
    const output = runHook({ workspace: { current_dir: root } }, ["--cli=claude", "--event=session-start"], { PRUMO_HOME: join(here, "..", "..", "..") });
    const parsed = JSON.parse(output);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(parsed.hookSpecificOutput.additionalContext, /CLAUDE\.md was written into/);
    assert.equal(existsSync(join(root, "CLAUDE.md")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the passive Grok hook stays silent when seeding is disabled", () => {
  const root = workspace();
  try {
    const output = runHook({ cwd: root }, ["--cli=grok", "--event=post-compact", "--no-seed"]);
    assert.equal(output, "");
    assert.equal(existsSync(join(root, "AGENTS.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a broken payload never fails the hook", () => {
  const output = execFileSync(process.execPath, [hook, "--cli=codex", "--no-seed"], { input: "not json", encoding: "utf8" });
  assert.match(output, /PRUMO PROTOCOL ACTIVE/);
});
