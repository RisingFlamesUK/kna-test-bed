# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Hierarchical reporter with hierarchy-context routing**: Each CI emission now identifies its area/config/testGroup/test for accurate routing and dynamic Test Group headers:
  - New `HierarchyContext` interface in `suite/types/ci.ts` to track emission context
  - CI component encodes context as `[HIERARCHY:json]` prefix for reporter parsing
  - Reporter extracts context from console logs for definitive routing (replaces content-based heuristics)
  - Test Group headers now appear immediately before each group's first output (not all at top)
  - Buffered lines preserve context for correct header placement when flushed

### Changed

- **Centralized CI formatting**: Moved all output formatting to CI component for consistency across Suite, Schema, and Scenarios:
  - `ci.testStep()` now auto-formats as `- <icon> <text>` with consistent bullet prefixes
  - Removed transform logic from reporter (no longer modifies console output)
  - Log URLs changed from `ci.testStep()` with 'ok' status to `ci.write()` for informational display (no status icon)
- **Canonical scenario identifier**: Removed legacy `scenarioName` fallbacks in favor of `testGroupName` as sole canonical identifier:
  - Updated scenario runner, scaffold/env/files assertions, and all type definitions
  - Scenario test configs (`test/e2e/scenarios/*/config/tests.json`) now use `testGroupName` exclusively

### Fixed

- **Duplicate log URLs**: Removed duplicate emission in scenario runner by deleting "backstop" emission in finally block. Removed `emittedLogUrls` deduplication Set from reporter (no longer needed).
- **Missing step output**: Suite and Schema tests now emit console output for all test steps via `ci.testStep()` calls. Previously only wrote to log files and detail JSON.
- **Test Group header timing**: Headers now appear at correct time in all areas (Suite, Schema, Scenarios) immediately before each test group runs instead of all at area start.

### Removed

- **Legacy scenario naming**: Deleted obsolete `test/e2e/scenarios/_runner/prompt-map.schema.test.ts` (functionality covered by main schema validation test)

## [0.4.4] – 2025-10-27

### Changed

- **Schema test CI output title**: Changed schema test area bullet from "Validating prompt-map.json files..." to "Validating schema files..." to reflect the expanded scope (now validates 6 schema types, not just prompt-map).
- **Constants refactoring**: Centralized all hardcoded strings into constants for improved maintainability and consistency:
  - Added 18 new constants in `suite/components/constants.ts` across 6 categories: JSON artifact filenames (4), log filenames (2), test patterns (3), directory paths (5), environment variable names (3), and default paths (1).
  - Added 4 test timeout constants in `test/components/test-constants.ts`: per-prompt timeouts (15s, 20s) and test-level timeouts (60s, 180s).
  - Refactored 10 files to use constants: `detail-io.ts`, `sequencer.ts`, `vitest-reporter.ts`, `global-setup.ts`, `suite.test.ts`, `schema-runner.ts`, `scenario-runner.ts`, `interactive-driver.ts`, and previously existing `SUITE_BULLET`/`SCHEMA_BULLET` usage.
  - Provides single source of truth for all infrastructure strings and timeout values, preventing bugs from stale references and making timeout tuning easier.

### Fixed

- **Schema test box closing**: Fixed critical bug where schema test output box was closing after scenario tests instead of immediately after schema section. Root cause: `vitest-reporter.ts` `onFinished` method was checking for old v0.4.2 filename pattern `prompt-map.schema.test.ts` instead of current `schema-validation.test.ts`. Now uses `SCHEMA_TEST_PATTERN` constant for correct detection.
- **Schema test progressive streaming**: Fixed bug where schema test steps were buffered and dumped all at once instead of streaming progressively. Root cause: `performClose` method was unconditionally clearing `activeFileKey` after switching to the next area, preventing the polling mechanism from working. Now only clears `activeFileKey` when there are no more areas to process.
- **Interactive test timeout handling**: Increased scenario test timeout from 120 seconds to 180 seconds to accommodate interactive prompts. Enhanced interactive driver timeout errors to include last 500 characters of output and prompt count for better diagnostics when timeouts occur.

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
