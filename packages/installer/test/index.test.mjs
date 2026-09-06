import test from "node:test";
import assert from "node:assert/strict";
import { parseArguments } from "../src/index.mjs";

test("headless arguments preserve explicit selections", () => {
  const options = parseArguments(["--only", "claude", "--dry-run", "--no-statusline"]);
  assert.deepEqual(options.only, ["claude"]);
  assert.equal(options.dryRun, true);
  assert.equal(options.statusline, false);
  assert.equal(options.headless, true);
});

test("invalid arguments fail before any installation plan is built", () => {
  assert.throws(() => parseArguments(["--only"]), /requires an agent id/);
  assert.throws(() => parseArguments(["--only", "gemini"]), /unknown agent id/);
  assert.throws(() => parseArguments(["--wat"]), /unknown option/);
  assert.throws(() => parseArguments(["--all", "--only", "codex"]), /cannot be used together/);
});
