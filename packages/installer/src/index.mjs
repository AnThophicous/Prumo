import { homedir } from "node:os";
import { ADAPTERS, applyPlan, planInstall } from "./install.mjs";
import { detectAll } from "./detect.mjs";

const USAGE = `prumo-install [options]

  --all                 install for every detected agent
  --only <id>           install for one agent (claude, codex, cursor, grok)
  --dry-run             print every step without touching a file
  --no-statusline       skip status line configuration
  --user-protocol       copy the protocol into the agent home directory
  --list                print detection results and exit
  --help                print this message
`;

export async function main(argv = process.argv.slice(2), env = process.env, home = homedir()) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const targets = detectAll(ADAPTERS, env, home);
  if (options.list) {
    for (const target of targets) {
      process.stdout.write(`${target.installed ? "found    " : "missing  "}${target.id.padEnd(8)}${target.label} (${target.evidence})\n`);
    }
    return 0;
  }
  const interactive = !options.headless && process.stdin.isTTY === true && process.stdout.isTTY === true;
  if (interactive) {
    const { runInstallerUi } = await import("./ui/app.mjs");
    const outcome = await runInstallerUi(targets, { statusline: options.statusline, userProtocol: options.userProtocol, dryRun: options.dryRun });
    reportHeadless(outcome.results, outcome.options.dryRun);
    return outcome.results.some(record => record.status === "failed") ? 1 : 0;
  }
  const selection = options.only.length > 0 ? options.only : targets.filter(target => target.installed).map(target => target.id);
  if (selection.length === 0) {
    process.stdout.write("no agent CLI detected on this machine\n");
    return 0;
  }
  const { plan } = planInstall(selection, { statusline: options.statusline, userProtocol: options.userProtocol }, env, home);
  const results = applyPlan(plan, { dryRun: options.dryRun });
  reportHeadless(results, options.dryRun);
  return results.some(record => record.status === "failed") ? 1 : 0;
}

function reportHeadless(results, dryRun) {
  for (const record of results) {
    process.stdout.write(`${record.status.padEnd(8)}${record.label.padEnd(22)}${record.title}\n          ${record.path}\n`);
  }
  const applied = results.filter(record => record.status === "applied").length;
  const failed = results.filter(record => record.status === "failed").length;
  process.stdout.write(dryRun
    ? `\n${results.length} step(s) planned, nothing written\n`
    : `\n${applied} step(s) applied, ${failed} failed\n`);
}

export function parseArguments(argv) {
  const options = { all: false, only: [], dryRun: false, statusline: true, userProtocol: false, list: false, help: false, headless: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--all") options.all = true;
    else if (argument === "--only") {
      const id = argv[index + 1];
      if (!id || id.startsWith("--")) throw new Error("--only requires an agent id");
      if (!ADAPTERS.some(adapter => adapter.id === id)) throw new Error(`unknown agent id: ${id}`);
      options.only.push(id);
      index += 1;
    }
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--no-statusline") options.statusline = false;
    else if (argument === "--user-protocol") options.userProtocol = true;
    else if (argument === "--list") options.list = true;
    else if (argument === "--headless") options.headless = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  if (options.all && options.only.length > 0) throw new Error("--all and --only cannot be used together");
  if (options.all || options.only.length > 0 || options.dryRun) options.headless = true;
  return options;
}
