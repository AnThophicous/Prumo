#!/usr/bin/env node
import { buildContext, hookPayload, resolveWorkspace, seedProtocol } from "../src/protocol.mjs";

const STDIN_TIMEOUT_MS = 800;
const STDIN_LIMIT = 4_000_000;

main();

async function main() {
  const options = parseArguments(process.argv.slice(2));
  try {
    const payload = parseJson(await readStdin());
    const workspace = resolveWorkspace(payload);
    const seeded = options.seed ? seedProtocol(workspace, options.cli) : { written: false, present: true };
    process.stdout.write(hookPayload(options.cli, options.event, buildContext(seeded, workspace, options.cli)));
  } catch {
    process.exitCode = 0;
  }
}

function parseArguments(argv) {
  const options = { cli: "generic", event: "session-start", seed: process.env.PRUMO_SEED !== "0" };
  for (const argument of argv) {
    const [flag, value] = argument.split("=");
    if (flag === "--cli" && value) options.cli = value;
    if (flag === "--event" && value) options.event = value;
    if (flag === "--no-seed") options.seed = false;
  }
  return options;
}

function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
      resolve(value);
    };
    const timer = setTimeout(() => finish(data), STDIN_TIMEOUT_MS);
    const onData = chunk => {
      data += chunk;
      if (data.length > STDIN_LIMIT) finish(data.slice(0, STDIN_LIMIT));
    };
    const onEnd = () => finish(data);
    const onError = () => finish("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
  });
}

function parseJson(payload) {
  if (!payload) return {};
  try {
    const value = JSON.parse(payload);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
