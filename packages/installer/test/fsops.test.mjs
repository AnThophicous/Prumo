import test from "node:test";
import assert from "node:assert/strict";
import { stripJsonComments } from "../src/fsops.mjs";

test("JSONC cleanup preserves string data while removing comments and trailing commas", () => {
  const source = [
    "{",
    `  ${"//"} line comment`,
    '  "text": ",}",',
    '  "url": "https://example.com/a//b",',
    '  "items": [1, 2,],',
    `  ${"/*"} block comment ${"*/"}`,
    "}"
  ].join("\n");
  assert.deepEqual(JSON.parse(stripJsonComments(source)), {
    text: ",}",
    url: "https://example.com/a//b",
    items: [1, 2]
  });
});
