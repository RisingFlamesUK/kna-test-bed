# Changelog

All notable changes to this project will be documented in this file.

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
