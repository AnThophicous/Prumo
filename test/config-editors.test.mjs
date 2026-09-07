import assert from "node:assert/strict";
import { test } from "node:test";
import { JsoncError, appendToArray, getPath, readJsoncObject, removeArrayItems, removeKey, setPath } from "@prumocode/installer";
import { readTomlValue, removeTomlKey, upsertTomlValue } from "@prumocode/installer";

const SETTINGS = `{
  // theme comes first
  "theme": "dark", /* inline block */
  "hooks": {
    "PreToolUse": [{ "hooks": [{ "type": "command", "command": "echo 'http://x // not a comment' /* nor this */" }] }],
  },
  "custom": { "unknown": [1, 2, 3], "unicode": "héllo ✓" },
}
`;

test("jsonc: append a hook group keeps comments, trailing commas, strings with // and /* and unknown fields", () => {
  const next = appendToArray(SETTINGS, ["hooks", "SessionStart"], { hooks: [{ type: "command", command: "node hook.mjs" }] });
  assert.ok(next.includes("// theme comes first"));
  assert.ok(next.includes("/* inline block */"));
  assert.ok(next.includes(`"command": "echo 'http://x // not a comment' /* nor this */"`));
  assert.ok(next.includes(`"unicode": "héllo ✓"`));
  const parsed = readJsoncObject(next);
  assert.equal(parsed.hooks.SessionStart[0].hooks[0].command, "node hook.mjs");
  assert.deepEqual(parsed.custom.unknown, [1, 2, 3]);
  assert.equal(parsed.hooks.PreToolUse[0].hooks[0].command, "echo 'http://x // not a comment' /* nor this */");
});

test("jsonc: setPath creates nested objects, replaces existing values and removeKey removes cleanly", () => {
  const withStatus = setPath(SETTINGS, ["statusLine"], { type: "command", command: "node s.mjs", padding: 0 });
  assert.deepEqual(getPath(withStatus, ["statusLine"]), { type: "command", command: "node s.mjs", padding: 0 });
  const replaced = setPath(withStatus, ["statusLine", "padding"], 2);
  assert.equal(getPath(replaced, ["statusLine", "padding"]), 2);
  const removed = removeKey(replaced, ["statusLine"]);
  assert.equal(removed.removed, true);
  assert.equal(getPath(removed.text, ["statusLine"]), undefined);
  assert.equal(getPath(removed.text, ["theme"]), "dark");
  const deep = setPath("", ["hooksConfig", "enabled"], true);
  assert.deepEqual(readJsoncObject(deep), { hooksConfig: { enabled: true } });
});

test("jsonc: empty file, BOM and CRLF are preserved", () => {
  const empty = appendToArray("", ["hooks", "sessionStart"], { type: "command", command: "x" });
  assert.deepEqual(readJsoncObject(empty), { hooks: { sessionStart: [{ type: "command", command: "x" }] } });
  const bom = `\uFEFF{\r\n  "a": 1\r\n}\r\n`;
  const next = setPath(bom, ["b"], "two");
  assert.ok(next.startsWith("\uFEFF"));
  assert.ok(next.includes("\r\n"));
  assert.doesNotMatch(next.replaceAll("\r\n", ""), /\n/);
  assert.deepEqual(readJsoncObject(next), { a: 1, b: "two" });
});

test("jsonc: malformed input raises JsoncError instead of being replaced", () => {
  assert.throws(() => readJsoncObject(`{ "a": [1, 2 `), JsoncError);
  assert.throws(() => setPath(`{ "a": tru }`, ["b"], 1), JsoncError);
});

test("jsonc: removeArrayItems removes only matching items and keeps the rest byte-for-byte", () => {
  const text = `{\n  "hooks": {\n    "sessionStart": [\n      { "command": "keep me" }, // mine\n      { "command": "node prumo-hook.mjs --cli=cursor" }\n    ]\n  }\n}\n`;
  const result = removeArrayItems(text, ["hooks", "sessionStart"], item => String(item.command).includes("prumo-hook.mjs"));
  assert.equal(result.removed, 1);
  assert.ok(result.text.includes(`{ "command": "keep me" } // mine`), result.text);
  assert.deepEqual(getPath(result.text, ["hooks", "sessionStart"]), [{ command: "keep me" }]);
});

const TOML = `\uFEFFmodel = "gpt-5"\r\n\r\n# features\r\n[features]\r\nfoo = true\r\n\r\n[tui]\r\ntheme = "x"\r\n\r\n[ui.status_line]\r\ntype = "command"\r\n`;

test("toml: upsert into an existing table, a new table and a dotted table; BOM and CRLF preserved", () => {
  let next = upsertTomlValue(TOML, "features", "hooks", "true");
  next = upsertTomlValue(next, "tui", "status_line", '["a", "b"]');
  next = upsertTomlValue(next, "ui.status_line", "command", '"node s.mjs"');
  next = upsertTomlValue(next, "new_table", "key", "1");
  assert.ok(next.startsWith("\uFEFF"));
  assert.ok(next.includes("\r\n"));
  assert.ok(next.includes("# features"));
  assert.equal(readTomlValue(next, "features", "hooks"), "true");
  assert.equal(readTomlValue(next, "features", "foo"), "true");
  assert.equal(readTomlValue(next, "tui", "status_line"), '["a", "b"]');
  assert.equal(readTomlValue(next, "ui.status_line", "command"), '"node s.mjs"');
  assert.equal(readTomlValue(next, "ui.status_line", "type"), '"command"');
  assert.equal(readTomlValue(next, "new_table", "key"), "1");
  const again = upsertTomlValue(next, "features", "hooks", "true");
  assert.equal(again, next);
});

test("toml: duplicate section uses the first match and removing keys deletes empty tables", () => {
  const dup = `[features]\nfoo = 1\n\n[other]\nx = 1\n\n[features]\nbar = 2\n`;
  const next = upsertTomlValue(dup, "features", "hooks", "true");
  assert.equal(next.indexOf("hooks = true") < next.indexOf("[other]"), true);
  const removed = removeTomlKey(`[tui]\nstatus_line = 1\n\n[features]\nhooks = true\n`, "tui", "status_line");
  assert.equal(removed.removed, true);
  assert.doesNotMatch(removed.text, /\[tui\]/);
  assert.match(removed.text, /\[features\]\nhooks = true/);
  const untouched = removeTomlKey(`[a]\nb = 1\n`, "a", "missing");
  assert.equal(untouched.removed, false);
});

test("toml: empty file becomes a single table", () => {
  const next = upsertTomlValue("", "features", "hooks", "true");
  assert.equal(next, "[features]\nhooks = true\n");
});
