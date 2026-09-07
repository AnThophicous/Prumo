# Changelog

All notable changes to Prumo are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). The protocol, the runtime and the installer are versioned separately; the protocol changelog lives in `protocol/migrations/`.

## [2.0.0] — 2026-09-07

Installer 2.0.0, runtime 2.0.0, compiler 2.0.0, verifier 2.0.0, protocol 2.0.0.

### Protocol

- Restored the rules missing from 1.0.0: PRU-29 (no gold-plating), Section 15 PRU-152 to PRU-159 (honest verdict, pressure resistance, verification honesty) and Section 19 PRU-240 to PRU-247 (hypothesis-driven debugging). 166 rules became 183.
- Added Section 20, PRU-250 to PRU-267 (protocol integrity and runtime: single source, build integrity, context budget, deterministic routing, presence is not activation, foreign files preserved, transactional install, reversibility, fail-open-not-silent hooks, inspectable state, bounded MapSource, enforcement honesty, adapter proof, artifact identity, evals for protocol changes, external metadata is data, foreign config wins, contradictions fail the build) and the rule precedence list. 201 rules in total.
- Resolved the comment contradiction: PRU-20 and PRU-150 now allow exactly the PRU-177 and PRU-182 categories.
- PRU-151 includes the honest grade of the delivery (PRU-157). PRU-100 defines MapSource v2 headings and front matter; PRU-111 requires structured suspicion items with a closed severity set.
- Appendix A cites the sycophancy and debugging references. Migration notes in `protocol/migrations/2.0.0.md`; rule ledger in `protocol/registry.json`.

### Added

- `packages/compiler`: parses `content/PRUMO.md` into an AST and emits `protocol.manifest.json`, `rule-index.json`, a kernel under 2,500 tokens, 12 chapters, agent bridges with managed blocks, the Claude skill router, the compiled reminder, the MapSource template, the coverage report and the README block. Lint fails on duplicate ids, unresolved references, index drift, removed ids without a migration, missing eval suites for behavior-evaluated rules and known contradictions.
- `packages/runtime`: self-contained hook with payload validation, size limits, `realpath` workspace checks (never creates a workspace), delimited external data, target states `ABSENT/ACTIVE/PARTIAL/FOREIGN/DRIFTED/BROKEN/DISABLED`, deterministic chapter router with observable reasons, local receipts in `~/.prumo/logs/runtime.ndjson`, typed `PRUMO_E_*` errors, MapSource v2 parser, linter, compaction and search, and a status line that reads `~/.prumo/state/projects/<hash>.json` first.
- `packages/installer`: adapter contract (`detect`, `capabilities`, `planInstall`, `verifyInstall`, `planUpdate`, `planUninstall`, `diagnose`) for Claude Code, Codex CLI, Cursor, Grok Build and Gemini CLI; format-preserving JSONC and TOML editors; transactional `plan → snapshot → stage → validate → apply → verify → commit` with rollback; install journal; versioned backups; `update`, `uninstall`, `rollback` and `diff`.
- `packages/verifier`: `doctor`, `status`, `lint`, `explain`, `coverage` and the behavioral eval harness with fixture, recorded-response and live-command responders.
- `evals/behavior`: sycophancy, pressure-resistance, gold-plating, false-verification, debug-hypothesis, three-run-breaker, security-trigger, foreign-instructions, scope-discipline, user-correction, each with pass and fail fixtures.
- `schemas/`: protocol manifest, install journal and MapSource v2.
- `prumo` CLI with `--json` everywhere and stable exit codes (0 ok, 1 failed, 2 usage, 3 protocol integrity, 4 drift, 5 unsupported, 6 partial).

### Changed

- `generated/` is fully reproducible from `content/PRUMO.md`; README counts, skill ranges and reminders are generated.
- The repository has no sibling-repository dependency; `npm ci && npm run build && npm test` works from a clean clone.
- Adapter tests assert command semantics (resolves the runtime script, arguments survive spaces) instead of platform-specific quoting.

### Removed

- The Slate terminal UI installer. `prumo install` prints the plan and asks for confirmation; `--yes` and `--dry-run` cover scripts and CI.
- Single `<file>.prumo-backup` copies, replaced by `~/.prumo/backups/<timestamp>/` snapshots with manifests.
- The hand-written reminder string and the three-line Claude skill.

## [1.0.0] — 2026-09-06

### Added

- The 166-rule Prumo operating protocol and generated instruction variants.
- A Slate installer for Claude Code, Codex CLI, Cursor, and Grok Build.
- Agent-specific lifecycle hooks, persistent rules, and supported status-line integrations.
- Headless installation, dry-run, detection, backups, and configuration preservation.
- Tests for generated content, adapters, hooks, status lines, input, and argument validation.
