import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const statusline = join(here, "..", "statusline", "prumo-statusline.mjs");

function render(payload, env = {}) {
  return execFileSync(process.execPath, [statusline], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

test("the badge appears only where the protocol is installed", () => {
  const withProtocol = mkdtempSync(join(tmpdir(), "prumo-status-on-"));
  const withoutProtocol = mkdtempSync(join(tmpdir(), "prumo-status-off-"));
  try {
    writeFileSync(join(withProtocol, "AGENTS.md"), "# Prumo\n\nPRU-01 bootstrap\n");
    const on = render({ workspace: { current_dir: withProtocol }, model: { display_name: "Opus 5" } }, { NO_COLOR: "1" });
    assert.match(on, /^Workstate: \[Prumo\] \| Opus 5 \| /);
    const off = render({ workspace: { current_dir: withoutProtocol }, model: { display_name: "Opus 5" } }, { NO_COLOR: "1" });
    assert.doesNotMatch(off, /Prumo/);
    assert.match(off, /Opus 5 \| /);
  } finally {
    rmSync(withProtocol, { recursive: true, force: true });
    rmSync(withoutProtocol, { recursive: true, force: true });
  }
});

test("a markdown file without the marker does not light the badge", () => {
  const root = mkdtempSync(join(tmpdir(), "prumo-status-plain-"));
  try {
    writeFileSync(join(root, "AGENTS.md"), "# Some other protocol\n");
    const line = render({ cwd: root, model: { display_name: "Sonnet 5" } }, { NO_COLOR: "1" });
    assert.doesNotMatch(line, /Workstate/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the model falls back to a readable label and colors are emitted", () => {
  const root = mkdtempSync(join(tmpdir(), "prumo-status-color-"));
  try {
    writeFileSync(join(root, "AGENTS.md"), "PRU-01");
    const plain = render({ cwd: root }, { NO_COLOR: "1" });
    assert.match(plain, /unknown model/);
    const colored = render({ cwd: root, model: { display_name: "Opus 5" } }, { NO_COLOR: "", COLORTERM: "truecolor" });
    assert.match(colored, /\u001b\[48;2;19;31;47m/);
    assert.match(colored, /\u001b\[38;2;131;183;226mOpus 5/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a malformed payload still exits zero", () => {
  const output = execFileSync(process.execPath, [statusline], { input: "{", encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  assert.equal(typeof output, "string");
});
