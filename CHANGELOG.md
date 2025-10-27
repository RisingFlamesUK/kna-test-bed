# Changelog

All notable changes to this project will be documented in this file.

## [0.4.3] – 2025-10-27

### Added

- **JSON-driven schema test runner**: Implemented config-based schema validation similar to scenario tests:
  - New `test/e2e/schema/_runner/` directory with `schema-runner.ts` and `types.ts`.
  - Schema tests now load from `config/tests.json` (default) or `pre-release-tests/<version>/config/tests.json` (when `PRE_RELEASE_VERSION` is set; see `docs/pre-release-testing.md`).
  - Support for glob patterns to validate multiple files in a single test entry.
  - Per-file schema override capability (with optional `defaultSchema` fallback).
- **Comprehensive schema library**: Added schemas for all test configuration file types:
  - `scenario-tests.schema.json` - Validates scenario test configuration files (`tests.json`)
  - `env-manifest.schema.json` - Validates environment variable manifests (`env.json`)
  - `files-manifest.schema.json` - Validates file structure manifests (`files.json`)
  - `routes-manifest.schema.json` - Validates HTTP route manifests (`routes.json`)
  - `answers.schema.json` - Validates scaffold answer files (`answers.json`)

### Changed

- **Renamed schema test file**: `prompt-map.schema.test.ts` → `schema-validation.test.ts` to reflect broader schema validation scope (now validates 6 schema types).
- **Renamed prompt-map fixture**: `prompt-map.json` → `prompt-map-valid.json`.
- **Reorganized schema test structure**: Schema tests now use separate `config/` and `fixtures/` subdirectories. Pre-release tests organized under `pre-release-tests/<version>/` with their own `config/` and `fixtures/` (gitignored; see `docs/pre-release-testing.md`).
- **Standardized status output**: Changed test failure status from "Failed" (title case) to "FAILED" (all caps) across all test types (suite, schema, scenarios) for consistency.
- **Suite log schema summary**: The `suite.log` now includes a dedicated "Schema tests" section showing individual file validation results with counts, similar to the existing scenario tests section.

### Fixed

- **Suite test failure reporting**: Suite tests now properly record and display failure steps with ❌ icon and correct counts. Added `recordSuiteStep('fail', message)` calls in both error paths. Previously only successes were shown.
- **Schema test failure reporting**: Schema tests now validate files individually with per-file validation results, proper error formatting, boxed validation details, and accurate pass/fail counts.
- **Interactive test timeout handling**: Scaffold assertion now properly detects when the interactive driver times out waiting for a prompt and throws an error with diagnostic information. Previously, timeouts were logged but not treated as test failures, causing tests to appear to pass even when hung.

## [0.4.2] – 2025-10-24

### Added

- Env manifest supports `ignoreUnexpected` (suppresses only unexpected WARNs; does not alter required/optional rules).
- CI reporter improvement: Scenario area header includes a file:// link to the active `tests.json` (prefers pre-release config when set).
- Consolidated suite summary now includes clear reasons for WARN/FAIL (e.g., “required keys commented”, “optional keys active”) alongside counts.
- Pre-release test capability: when `PRE_RELEASE_VERSION` is set, the runner/reporter prefer a versioned config path by convention (no need to commit those assets; typically ignored in VCS).
- Convenience pre-release runner: `scripts/test-pre.mjs` with `npm run test:pre -- <version>` (forwards Vitest args) and `npm run test:pre:report` (always exit 0 for log collection).

### Changed

- Env assertion output aligned with the existing files assertion contract: compact section summaries, problem-only boxes, clear missing-file handling, and a single final status line printed last.
- Files assertion step header reads “Files: validate files against manifest.”
- Files assertion missing-manifest handling: prints a clear “Manifest file not found:” line and a boxed “Missing file” section before the final status (printed last).
- Env FAIL no longer stops the scenario early: the runner continues to the files step, then fails the scenario at the end (maximizes surfaced signal per run).

### Fixed

- CI output prints valid absolute file URLs; previously some links were relative or incorrect.
- Scenario step icons accurately reflect actual severities under pre-release config mapping.
- De-duplication of log pointers to avoid repeated “log:” lines; late logs are still surfaced before area footers.
- Removed duplicate Schema header output in the reporter.

## [0.4.1] – 2025-10-23

### Added

- Deterministic, progressive streaming for Suite and Schema, matching Scenarios with per-step lines and accurate counts (including `skip`).
- JSON artifacts for non-scenarios: `e2e/_suite-detail.json` (Suite) and `e2e/_schema-detail.json` (Schema). Reporter streams from these.
- Shared utilities: `suite/components/detail-io.ts`, `suite/components/ci.ts` (icons/boxing), `suite/components/constants.ts` (standard bullets).

### Changed

- Reporter activation order is stable: Suite → Schema → Scenarios. Group output is bullet → steps → summary → log link → footer without pauses.
- Scenario severities remain in `e2e/_scenario-detail.json` (single source of truth). Non-scenarios compute counts from their JSON streams.
- Documentation updates across `README.md`, `docs/components.md`, `docs/design.md`, and `docs/scenarios.md` to reflect streaming design.
- Restructured e2e layout:
  - Suite sentinel moved to `test/e2e/suite/suite.test.ts` (was `test/e2e/suite.test.ts`).
  - Schema assets moved to `test/e2e/schema/`:
    - Schema: `test/e2e/schema/config/prompt-map.schema.json`
    - Fixture: `test/e2e/schema/fixtures/prompt-map.json`
    - Test: `test/e2e/schema/prompt-map.schema.test.ts`
  - Scenario runner fallback now points to `test/e2e/schema/fixtures/prompt-map.json`.
  - Reporter schema detection updated to match the new path.
  - `package.json` scripts updated (`test:e2e`, `ci:validate:prompt-map(s)`) to use new locations.

### Removed

- Legacy `suite/vitest-reporter.ts` and `suite/components/ci-emitter.ts` replaced by the JSON-backed reporter and shared CI helpers.

### Fixed

- De-duplicated and immediately emitted log links for non-scenarios; no raw console bleed-through; corrected skipped counts in footers.

## [0.4.0] – 2025-10-07

### Added

- **Filesystem assertions (Phase 1)** via per-scenario `manifest/files.json`:
  - `required`, `forbidden`, `ignore` patterns (picomatch with `{ dot: true, nocase: true }`)
  - Outcome: **OK**, **WARN** (unexpected), **FAIL** (missing/forbidden)
  - Compact, boxed lists using `proc.logBoxCount`
- **Logger.warn(…)** for standardized warning lines (`⚠️ …`)
- **`proc.logBoxCount`** helper for boxed lists with a footer label
- Per-scenario severity sentinel (internal, for future suite-level summaries)

### Changed

- Scenario runner calls `fs-assert` **after** `.env` assertion and prints aligned `cwd=` / `manifest=` in the same step.
- Documentation updates for `components`, `scenarios`, `design`, and this changelog.

### Deprecated

- None.

### Removed

- None.

### Fixed

- Log alignment tweaks in fs-assert headers.
