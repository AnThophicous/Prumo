#!/usr/bin/env node
import { runHook } from "../src/hook.mjs";
import { readBoundedStdin } from "../src/stdin.mjs";
import { PAYLOAD_LIMIT_BYTES } from "../src/hook-input.mjs";
import { hookPayload } from "../src/context.mjs";
import { parseHookArguments } from "../src/hook.mjs";

main();

async function main() {
  const argv = process.argv.slice(2);
  try {
    const rawPayload = await readBoundedStdin({ limitBytes: PAYLOAD_LIMIT_BYTES });
    const result = runHook({ argv, rawPayload });
    process.stdout.write(result.stdout);
  } catch (error) {
    const options = parseHookArguments(argv);
    const message = `PRUMO RUNTIME FAILURE ${error && error.code ? error.code : "PRUMO_E_UNKNOWN"}: the hook failed open; run \`prumo doctor\`.`;
    if (process.env.PRUMO_DEBUG === "1") process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.stdout.write(hookPayload(options.cli, options.event, message));
  }
  process.exitCode = 0;
}
