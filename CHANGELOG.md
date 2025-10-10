# Changelog

All notable changes to this project will be documented in this file.

## [0.4.1] – 2025-10-09

### Added

- **Consolidated Step 7** in `suite.log`: Suite tests, Scenario schema tests, and Scenario tests with step-level breakdown (scaffold/env/files).
- **Custom reporter improvements:** quiet by default; enable per-file text with `--verbose`/`-v` or `KNA_VITEST_TEXT=1`. Reporter **always** writes `e2e/_vitest-summary.json`.
- **Single source of truth for severities:** `_scenario-detail.json` now contains per-scenario step results. `global-setup.ts` renders from this artifact.
- **Type coherency:** shared `ScenarioSeverity` used across modules.

### Changed

- `recordScenarioSeverityFromEnv(...)` now writes only to `_scenario-detail.json`; callers pass `{ step, meta }` where applicable.
- Suite-level roll-up uses worst-of across steps and scenarios; WARN is no longer treated as OK in summaries.
- Log links in Step 7 use relative paths (`./e2e/<scenario>.log`) for portability; CI may also print an absolute `file://` URL.

### Removed

- `_scenario-status.json` (redundant). Worst-of is computed from `_scenario-detail.json`.

### Fixed

- Windows `file://` URL issues in scenario log pointers.

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
