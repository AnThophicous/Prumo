<img src="assets/logo.svg" alt="Prumo" width="72" align="right" />

# Prumo — an operating protocol for coding agents, compiled

Prumo keeps coding agents on a verifiable delivery process across Claude Code, Codex CLI, Cursor, Grok Build, Gemini CLI and opencode. One canonical document, [`content/PRUMO.md`](content/PRUMO.md), is compiled into a small always-on kernel, task-triggered chapters, agent bridges and a rule manifest. A policy runtime loads only the chapters a task needs, a transactional installer wires the runtime into each agent, and a verifier proves that what is installed, loaded and claimed is the canonical policy.

A plumb line tells a builder whether a wall is straight. Prumo does the same for agent work: the model keeps its speed, while citable `PRU-xx` rules keep the delivery on the line.

<!-- PRUMO:GENERATED:BEGIN -->
The protocol contains **201 citable rules** (`PRU-01` to `PRU-267`) in 21 sections, compiled into a kernel of about 2184 tokens and 12 chapters. Protocol version `2.0.0`, source `sha256:9b0eec856ee7`. Supported targets: `claude`, `codex`, `cursor`, `grok`, `gemini`, `opencode`.
<!-- PRUMO:GENERATED:END -->

## How it works

```text
content/PRUMO.md  ──compiler──►  kernel + chapters + manifest + bridges + skill
                                        │
                                  policy runtime (~/.prumo)
                                        │
                      Claude · Codex · Cursor · Grok · Gemini · opencode
                                        │
                              verifier: doctor · status · lint · evals
```

- **Kernel** (under 2,500 tokens): identity, bootstrap, specification minimum, read-before-edit, batching, three-run breaker, honest verdict, verification honesty, MapSource minimum, delivery gate and the chapter router. Always injected.
- **Chapters**: `coding`, `specification`, `communication`, `judgment`, `debugging`, `security`, `git`, `architecture`, `mapsource`, `public-writing`, `subagents`, `protocol`. Loaded by observable triggers (task keywords, touched paths, signals). `security` cannot be suppressed once triggered.
- **Bridges**: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, a Cursor rule and a Grok rule, each carrying a `<!-- PRUMO:BEGIN protocol=… hash=… -->` managed block. Only the block belongs to Prumo; foreign files are never replaced.
- **Manifest**: every rule with its section, chapter, tier, triggers, references, enforcement class and source line. Generated, never edited.

## Install

Requires Node.js 18 or newer and no sibling repositories.

Fastest — no clone needed:

```bash
npx -y @prumocode/install@latest install --yes   # detected agents
npx -y @prumocode/install@latest install opencode --yes
npx -y @prumocode/install@latest install --dry-run  # plan only, nothing written
```

From source:

```bash
git clone https://github.com/AnThophicous/Prumo.git
cd Prumo
npm ci
npm run build
node bin/prumo.mjs install            # detected agents, interactive confirmation
node bin/prumo.mjs install claude codex --yes
node bin/prumo.mjs install --dry-run  # plan only, nothing written
```

Installation is a transaction: `plan → snapshot → stage → validate → apply → verify → commit`. Any failure before commit rolls every file back. Snapshots live under `~/.prumo/backups/<timestamp>/` and the journal under `~/.prumo/state/install.json`.

## CLI

| Command | Purpose |
| --- | --- |
| `prumo install [targets]` | Install runtime, protocol and integrations. `--yes`, `--dry-run`, `--no-statusline`, `--user-protocol`. |
| `prumo update [targets]` | Recompile the protocol and migrate installed targets. |
| `prumo uninstall <t> \| --all` | Remove Prumo hooks, skills and managed blocks. Foreign configuration stays byte-for-byte. |
| `prumo rollback [id] [--list]` | Restore a snapshot. |
| `prumo diff` | What install or update would change, secrets redacted. |
| `prumo status [--task "…"] [--file p]` | Versions, target states, loaded chapters with reasons, token budget. |
| `prumo doctor` | Health check. Exit 3 protocol integrity, 4 drift, 6 partial, 1 broken. |
| `prumo lint` | Canonical protocol, generated artifacts and README integrity. |
| `prumo explain PRU-158` | Rule text, section, chapter, source line, related rules. |
| `prumo chapter debugging` | Print a compiled chapter. |
| `prumo coverage` | Enforcement class per rule: `ENFORCED`, `DETERMINISTICALLY_TESTED`, `BEHAVIOR_EVAL`, `MANUAL`. |
| `prumo state [lint\|search q\|compact]` | MapSource v2 operations in the current workspace. |
| `prumo eval [--suite s]` | Behavioral evals against fixtures, recorded responses (`--responses dir`) or a live agent (`--command`). |

Every command accepts `--json`. Exit codes are stable: `0` ok, `1` failed, `2` usage, `3` protocol integrity, `4` drift, `5` unsupported target, `6` partial state needing manual action.

## What it installs

| Agent | Hook | Persistent policy | Status line |
| --- | --- | --- | --- |
| Claude Code | `SessionStart` (refires on compact) in `~/.claude/settings.json` | `/prumo` skill with kernel, dispatch table and chapter references; optional managed block in `~/.claude/CLAUDE.md` | custom command |
| Codex CLI | `SessionStart` in `~/.codex/hooks.json`, `features.hooks = true` | optional managed block in `~/.codex/AGENTS.md` | native items in `tui.status_line` |
| Cursor | `sessionStart` in `~/.cursor/hooks.json` | always-on rule `~/.cursor/rules/prumo.mdc` | unchanged |
| Grok Build | `SessionStart` and `PostCompact` in `~/.grok/hooks/prumo.json` | global rule `~/.grok/rules/prumo.md` | custom command in `[ui.status_line]` |
| Gemini CLI | `SessionStart` in `~/.gemini/settings.json` | optional managed block in `~/.gemini/GEMINI.md` | none documented |
| opencode | `session.created` plugin at `~/.config/opencode/plugins/prumo-session.mjs` (session-start hook, once per session, fail-open) | `/prumo` skill in `~/.config/opencode/skills/prumo/` | unchanged |

Config files are edited with format-preserving JSONC and TOML editors: comments, trailing commas, CRLF, BOM and unknown keys survive. A malformed file stops the step and is never replaced.

## Target states

`ABSENT`, `ACTIVE`, `PARTIAL`, `FOREIGN`, `DRIFTED`, `BROKEN`, `DISABLED`. A file with the right name is never reported active: activation requires the managed marker, the protocol version and a valid content hash. An `AGENTS.md` without Prumo ownership is `FOREIGN`; the runtime still injects the kernel by hook and leaves the file alone.

## Runtime guarantees

- The hook validates the payload schema and size, resolves the workspace with `realpath`, requires an existing directory and never creates one.
- External values (paths, branch names, payload fields) enter the context as delimited data, never as instructions.
- The hook fails open for the agent but never silently: every failure writes a structured receipt to `~/.prumo/logs/runtime.ndjson` (timestamp, event, adapter, error code, redacted path). No prompts, file contents or secrets are logged. `PRUMO_DEBUG=1` adds local detail. No telemetry.
- `PRUMO_SEED=0` disables bridge seeding and is reported as `DISABLED`, not as "already present".

## Protocol integrity

The build fails on a duplicate id, a removed id without a migration entry, an unresolved `PRU-*` or section reference, an index mismatch, a stale generated file, a wrong rule range or a manual count in the README. Known contradictions (comments in PRU-20/150 versus PRU-177/182) are encoded in the linter. Changes to stable rules are recorded in [`protocol/migrations/`](protocol/migrations/) and ids are never recycled.

Rule precedence when two rules collide: security and privacy, data integrity, explicit user decision, existing public contract, active specification, repository convention, Prumo preference.

## Behavioral evals

`evals/behavior/` holds the suites `sycophancy`, `pressure-resistance`, `gold-plating`, `false-verification`, `debug-hypothesis`, `three-run-breaker`, `security-trigger`, `foreign-instructions`, `scope-discipline` and `user-correction`. Each case has a deterministic judge and a pass and a fail fixture; the test suite proves the judges discriminate. Release gates: core pass rate at least 95 percent, critical-rule pass rate 100 percent. A rule is called `ENFORCED` only when a mechanism prevents the violation; prompted rules are `BEHAVIOR_EVAL` or `MANUAL`.

## Configuration

| Option or variable | Default | Effect |
| --- | --- | --- |
| `PRUMO_HOME` | `~/.prumo` | Runtime, protocol, state, backups and logs directory |
| `PRUMO_SEED=0` | seeding on | Hooks never create project instruction files |
| `PRUMO_DEBUG=1` | off | Detailed local diagnostics in the runtime log |
| `--no-statusline` | status lines on | Skip status-line changes |
| `--user-protocol` | off | Attach the managed block to the agent's user-level instruction file |
| `NO_COLOR` | unset | Status line without ANSI color |

## Development

```bash
npm ci
npm run build      # compile content/PRUMO.md into generated/, AGENTS.md and the README block
npm run lint       # protocol, generated artifacts, README
npm test           # integrity, mutation, config editors, adapters, transaction, runtime, evals
npm pack --dry-run
```

Layout: `packages/compiler` (parser, lint, renderers), `packages/runtime` (self-contained hook, router, state machine, MapSource v2, status line; copied into `~/.prumo/runtime`), `packages/installer` (adapters, JSONC/TOML editors, transaction, journal, CLI), `packages/verifier` (doctor, status, lint, eval harness), `evals/`, `schemas/`, `protocol/` (registry and migrations).

## Non-goals

Prumo is not an IDE, a SaaS, a telemetry system, a CI platform, a secrets manager, a Git or issue-tracker replacement, an agent framework or a mandatory subagent orchestrator. It is protocol, runtime, installation and verification.

## License

MIT. See [LICENSE](LICENSE). Authors and reuse credits: [AUTHORS.md](AUTHORS.md) — keep it with any copy or redistribution.
