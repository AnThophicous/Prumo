import { homedir } from "node:os";
import { seedBridge } from "./bridge.mjs";
import { buildContext, hookPayload } from "./context.mjs";
import { describeError } from "./errors.mjs";
import { parsePayload, resolveWorkspace } from "./hook-input.mjs";
import { appendReceipt } from "./log.mjs";
import { writeProjectState } from "./project-state.mjs";
import { loadProtocol } from "./protocol-store.mjs";
import { detectBridge } from "./state.mjs";

export function parseHookArguments(argv, env = process.env) {
  const options = { cli: "generic", event: "session-start", seed: env.PRUMO_SEED !== "0" };
  for (const argument of argv) {
    const [flag, value] = argument.split("=");
    if (flag === "--cli" && value) options.cli = value;
    if (flag === "--event" && value) options.event = value;
    if (flag === "--no-seed") options.seed = false;
  }
  return options;
}

export function runHook({ argv = [], rawPayload = "", env = process.env, home = homedir(), cwd = process.cwd(), now = new Date() } = {}) {
  const started = Date.now();
  const options = parseHookArguments(argv, env);
  let protocol;
  let payload = {};
  let workspace;
  let bridge;
  let failure;
  const record = error => {
    if (!failure) failure = describeError(error);
  };
  try {
    protocol = loadProtocol(env, home);
  } catch (error) {
    record(error);
  }
  try {
    payload = parsePayload(rawPayload).payload;
  } catch (error) {
    record(error);
  }
  try {
    workspace = resolveWorkspace(payload, env, cwd).workspace;
  } catch (error) {
    record(error);
  }
  if (protocol && workspace) {
    try {
      bridge = options.seed
        ? seedBridge({ workspace, cli: options.cli, protocol, seedingEnabled: true })
        : { ...detectBridge({ workspace, cli: options.cli, currentVersion: protocol.manifest.protocolVersion, seedingEnabled: false }), action: "none" };
      try {
        writeProjectState(workspace, { protocol: protocol.manifest.protocolVersion, bridge: bridge.state, file: bridge.file, cli: options.cli }, { env, home, now });
      } catch (error) {
        appendReceipt({ event: "project-state", adapter: options.cli, code: describeError(error).code, path: workspace, detail: error.message }, { env, home, now });
      }
    } catch (error) {
      record(error);
    }
  }
  const injectKernel = Boolean(protocol?.kernel) && (!bridge || bridge.state !== "ACTIVE");
  const context = buildContext({
    reminder: protocol?.reminder,
    protocol,
    bridge,
    workspace,
    chaptersDir: protocol?.paths.chaptersDir,
    kernel: protocol?.kernel,
    injectKernel,
    error: failure
  });
  appendReceipt({
    event: options.event,
    adapter: options.cli,
    code: failure?.code ?? "OK",
    path: workspace,
    state: bridge?.state,
    action: bridge?.action,
    durationMs: Date.now() - started,
    detail: failure?.message
  }, { env, home, now });
  return { stdout: hookPayload(options.cli, options.event, context), context, bridge, workspace, failure, options };
}
