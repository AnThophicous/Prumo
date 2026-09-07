#!/usr/bin/env node
import { runCli } from "../src/cli.mjs";

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith("--") ? argv : ["install", ...argv.filter(argument => argument !== "--all")];
process.exitCode = await runCli(command);
