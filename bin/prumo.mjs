#!/usr/bin/env node
import { runCli } from "@prumocode/installer/cli";

process.exitCode = await runCli(process.argv.slice(2));
