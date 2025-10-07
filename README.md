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
```

Logs go to `logs/<STAMP>/…`:

- `suite.log`: suite setup/teardown (Docker, PG, env)
- per-scenario logs (e.g., `local-only-silent.log`, `local-only-answers.log`, `local-only-interactive.log`)
- meta checks (e.g., `prompt-map.schema.log`, `suite-sentinel.log`)

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

## New in v0.4.0

- **Filesystem assertions (Phase 1):** per-scenario `manifest/files.json` with `required`, `forbidden`, and `ignore` patterns.
  - Results can be **OK**, **WARN** (unexpected files), or **FAIL** (missing/forbidden).
  - See: [`docs/scenarios.md`](docs/scenarios.md#filesjson-filesystem-manifest) and [`docs/components.md`](docs/components.md#testcomponentsfs-assertts).

---

## Conventions

- TypeScript everywhere; avoid arbitrary sleeps; prefer readiness checks.
- Structured logs via `logger.ts` (`step/pass/fail`) and boxed sections via `proc.ts`.
- Keep exports lean; add features in crisp, incremental PRs.
