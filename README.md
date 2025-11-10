# kna-test-bed

End-to-end testbed for the **Kickstart Node App** scaffolder.

- Spins up Postgres in Docker (once per run)
- Runs scaffold flows (**silent**, **answers-file**, **interactive**)
- Asserts the generated outputs (e.g., `.env` contents)
- Writes step-by-step logs under `logs/<STAMP>/…`

---

## Quick start

```bash
# install deps
npm i

# run the whole e2e suite (docker + sample sanity + scenarios + schema checks)
npm run test:e2e

# watch the suite during development
npm run test:e2e:watch

# optional: run with a pre-release config version (auto-picks versioned tests.json when present)
# recommended (no npm warning, no CLI arg leakage):
PRE_RELEASE_VERSION=0.4.x npm test

# convenience (pass version as a positional arg):
npm run test:pre -- 0.4.x

# optionally forward Vitest args (e.g., run a subset):
npm run test:pre -- 0.4.x -t "silent mode: scaffolds app without errors"

# collect logs but always exit 0 (for inspection workflows):
npm run test:pre:report -- 0.4.x
```

Logs go to `logs/<STAMP>/…`:

- `suite.log`: suite setup/teardown (Docker, PG, env) with progressive, ordered groups: **Suite → Schema → Scenarios**
- per-scenario logs (e.g., `./e2e/local-only-silent.log`, `./e2e/local-only-answers.log`, `./e2e/local-only-interactive.log`)
- artifacts:
  - `./e2e/_suite-detail.json` (Suite steps), `./e2e/_schema-detail.json` (Schema steps)
  - `./e2e/_scenario-detail.json` (scenario step severities)
  - `./e2e/_vitest-summary.json` (per-file counts)
- meta checks (e.g., `schema-validation.log`, `suite-sentinel.log`)

### Verbose output (optional)

The suite is **quiet by default**. To print Vitest’s per-file lines in the suite.log:

- CLI: `npm run test -- --verbose` (or `-v`)
- Env: `KNA_VITEST_TEXT=1 npm test`

`_vitest-summary.json` is **always** written; the Step 7 summary in `suite.log` is available in both modes.

---

## Scenario runner (JSON-driven tests)

Each scenario folder (e.g., `test/e2e/scenarios/local-only/`) provides a `config/tests.json` that describes what to run. The test file:

```ts
// test/e2e/scenarios/local-only/local-only.test.ts
import { runScenariosFromFile } from '../_runner/scenario-runner.ts';

const CONFIG_PATH =
  process.env.SCENARIO_CONFIG ?? 'test/e2e/scenarios/local-only/config/tests.json';

await runScenariosFromFile(CONFIG_PATH);
```

Key points:

- We **assert the unmerged `.env`** first (verifies scaffolder output).
- `mergeEnv` is **present in JSON** but **intentionally ignored** by the runner for now (we’ll spec it next).
- Interactive scenarios can be driven by:
  - Low-level `prompts: Prompt[]`, or
  - A higher-level `include` list resolved via a **prompt-map** JSON.

See **[`docs/scenarios.md`](./docs/scenarios.md)** for the JSON formats (tests.json, prompt-map.json), schema validation, and examples.

---

## Components reference

The detailed API for suite and test components lives in **[`docs/components.md`](./docs/components.md)**.

Highlights:

- `suite/components/proc.ts` now includes `logBox()` for consistent boxed sections in logs.
- `test/components/env-assert.ts` enforces:
  - `required` keys: active (uncommented)
  - `optional` keys: present but commented
  - optional value checks via `expect`
  - on failure: **boxed annotated** `.env` dump with a legend
- `test/components/interactive-driver.ts`:
  - text + checkbox prompts
  - strong diagnostics on timeout
- `test/components/scaffold-command-assert.ts`:
  - interactive mode uses the driver when prompts are provided

---

## CI helpers

```bash
# Validate a single prompt-map against the schema
npm run ci:validate:prompt-map

# Validate all prompt-maps
npm run ci:validate:prompt-maps
```

We use `--spec=draft2020` for AJV.

---

## New in v0.4.5

- **Hierarchical reporter with hierarchy-context routing**: Each CI emission can now identify its area/config/testGroup/test for accurate routing:
  - New `HierarchyContext` interface for tracking emission context
  - Reporter extracts context from `[HIERARCHY:json]` prefix for definitive routing
  - Dynamic Test Group headers appear immediately before each group (not all at top)
  - Centralized CI formatting in `ci.ts` component for consistency
- **Parallel schema test execution**: Schema validation tests now run concurrently via `it.concurrent()` blocks:
  - ~20-25% performance improvement (15-17s vs. 18-20s)
  - Individual concurrent test for each file validation (16+ tests)
  - Scenarios remain sequential (ordered dependencies + TTY conflicts)
- **Deferred logging architecture**: Clean, sequential log output despite parallel execution:
  - Tests collect results in `_schema-detail.json` during parallel execution
  - Final test reads detail JSON and generates formatted log with perfect sequential numbering (1..N)
  - Eliminates race conditions and log interleaving
- **Canonical scenario identifier**: `testGroupName` is now the sole identifier (removed legacy `scenarioName` fallbacks)
- **Code cleanup**: Removed unused code including `expandPattern()` helper function and `suite/components/format.ts`
- **ESLint configuration**: Added file-pattern exception for test runners to allow dynamic test titles from JSON config

## New in v0.4.4

- **Constants refactoring**: Centralized all hardcoded strings and timeout values into two dedicated files:
  - `suite/components/constants.ts`: 18 infrastructure constants (filenames, patterns, directories, env vars)
  - `test/components/test-constants.ts`: 4 test timeout constants (per-prompt and test-level timeouts)
  - Refactored 10 files to use constants for improved maintainability
- **Bug fixes**:
  - Schema test box now closes immediately after schema section (was closing after scenarios due to stale filename pattern)
  - Schema tests now stream progressively (fixed activeFileKey clearing bug that caused buffering)
  - Interactive test timeout handling improved (increased to 180s, better diagnostic messages)

## New in v0.4.3

- **Suite and Schema test failure reporting**: Tests now properly record and display failure steps with accurate pass/fail counts.
- **JSON-driven schema test runner**: Config-based schema validation with glob pattern support and per-file schema overrides.
- **Comprehensive schema library**: Schemas for all test configuration file types (scenario-tests, env-manifest, files-manifest, routes-manifest, answers).
- **Suite log enhancements**: Schema tests now appear in `suite.log` with individual file validation results and counts, matching the scenario tests section format.
- **Interactive test timeout handling**: Timeouts are now properly detected and reported as test failures with diagnostic information.
- Reorganized schema test structure with separate `config/` and `fixtures/` subdirectories for better organization.

## New in v0.4.2

- Env assertions aligned with fs-assert output contract:
  - Compact summaries + problem-only boxes; a single final status line printed last: `✅ env-assert: OK` | `⚠️ env-assert: WARN` | `❌ env-assert: FAIL`.
  - `ignoreUnexpected` now supported (suppresses only unexpected WARNs; does not override required/optional rules).
  - Clear “Missing file” handling for absent `.env` or `env.json` (message + boxed section before final `❌`).
- Scenario runner continues to the files step after an env `FAIL` and records both severities for the reporter.
- Files step header renamed to: “Files: validate files against manifest.” Missing manifest prints a boxed “Missing file” and then `❌ fs-assert: FAIL`.
- Docs updated: components, scenarios (including env.json manifest semantics), and design.

## New in v0.4.1

- Deterministic, JSON-backed streaming in the custom reporter: Suite/Schema now print step lines like Scenarios with accurate counts (incl. skip) and immediate log links/footers.
- Shared utilities: centralized severity icons, JSON detail IO, and reporter constants to keep output consistent across areas.
- Stable order: Suite → Schema → Scenarios, with de-duplicated log pointers and no raw console bleed-through.

## New in v0.4.0

- **Filesystem assertions (Phase 1):** per-scenario `manifest/files.json` with `required`, `forbidden`, and `ignore` patterns.
  - Results can be **OK**, **WARN** (unexpected files), or **FAIL** (missing/forbidden).
  - See: [`docs/scenarios.md`](docs/scenarios.md#filesjson-filesystem-manifest) and [`docs/components.md`](docs/components.md#testcomponentsfs-assertts).

---

## Conventions

- TypeScript everywhere; avoid arbitrary sleeps; prefer readiness checks.
- Structured logs via `logger.ts` (`step/pass/fail`) and boxed sections via `proc.ts`.
- Keep exports lean; add features in crisp, incremental PRs.
