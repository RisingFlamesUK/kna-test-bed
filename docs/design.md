# kna-test-bed — Design

## Goals

- Automate end-to-end testing of `kickstart-node-app`.
- Practice app+infra assembly with Docker Desktop + Postgres.
- Exercise CLI flows (flags, answers file, interactive).
- Verify:
  - the CLI scaffolds the correct files
  - the scaffolded app starts successfully
  - (later) core routes (public/protected/auth) behave as expected

## Non-Goals

- Browser/UI testing.
- Stress/perf testing.
- Multi-cloud orchestration; (we target local Docker Desktop)

---

## Architecture Overview

- **One global suite controller** (Vitest `globalSetup`) that:
  - starts **a single Postgres container** for the entire run
  - exposes **suite PG env** via `process.env` as `SUITE_PG_HOST|PORT|USER|PASS`
  - stamps logs with `KNA_LOG_STAMP` and maintains a **suite log** (`logs/<stamp>/suite.log`)
  - cleans up temp apps, test DBs, and the container on teardown
- **Scenario runner**: JSON-driven scenarios via `test/e2e/scenarios/_runner/scenario-runner.ts`.
  - Reads `config/tests.json`
  - Runs **scaffold** → **assert (unmerged .env)** → (merge step reserved; **skipped** for now)
  - Uses `prompt-map.json` to expand higher-level `include` → concrete interactive prompts
  - Manifests and answers files are resolved with deterministic search order; set `E2E_DEBUG_RESOLVE=1` to log candidates
- **Test helpers**: `test/components/*`
  - `scaffold-command-assert.ts`, `interactive-driver.ts`, `env-assert.ts`
  - future: `server-assert.ts`, `fs-assert.ts`
- **Per-scenario manifests** (expected files/env/routes) live under each scenario folder.
- **Subprocess handling:** `suite/components/proc.ts` exposes:
  - `execBoxed` for buffered runs (args nicely wrapped, exit code footer).
  - `openBoxedProcess` for streaming/interactive runs (stdin access) with **ANSI stripped** so logs stay readable (e.g., checkbox menus).
  - `logBox` for generic boxed sections (used by annotated `.env` dumps).

- **Reporter & streaming**
  - The custom reporter streams in a deterministic order: **Suite → Schema → Scenarios**.
  - Suite/Schema step lines are read from JSON artifacts (`e2e/_suite-detail.json`, `e2e/_schema-detail.json`).
  - Scenario step severities come from `_scenario-detail.json` (single source of truth).
  - Each group prints: bullet → step lines → summary → log link → footer, without batching or pauses.
  - Skip is included in counts. Taskless console noise is ignored to prevent bleed-through.

---

## High-level flow

1. **globalSetup**
   - Stamp logs (`KNA_LOG_STAMP`) and open `logs/<stamp>/suite.log`.
   - **Docker checks**: `ensureDocker()`; remove stale containers by label (boxed `docker ps`/`rm` output).
   - **Postgres up**: ensure image, run container (boxed `docker run`), wait for **healthy** and **TCP**.
   - Publish `SUITE_PG_HOST|PORT|USER|PASS` to `process.env` (read later via `getSuitePgEnv()`).
   - Write a clear **“Run Tests”** anchor in the suite log (the reporter indents under this).

2. **Each test**
   - **Scaffold** temp app with the CLI (boxed generator output via `execBoxed`).
   - **Assert .env** matches the scenario manifest (required keys **active**, optional keys **commented**).

- (Later) **Merge env**: inject values from `./.real-env/.real.env` and suite PG env — without clobbering OAuth/explicit `PORT`.
- (Later) **Start server** and run assertions (files/env/routes/auth).
- **Cleanup** temp app (unless `keepArtifacts`).

3. **globalTeardown**
   - Stop/remove the PG container (boxed `docker stop`/`rm` if used).
   - Close the suite logger and print a pointer to `logs/<stamp>`.

---

## Structure:

```
kna-test-bed
├── .tmp                                      # temp directory (cleaned at the end of a run)
├── docs
│   ├── components.md                         # components reference & API
│   ├── design.md                             # design and architecture (this file)
│   └── scenarios.md                          # scenario runner and manifests
├── logs
│   └── <timestamp>
│       ├── e2e                               # e2e logs per test run
│       │   ├── _scenario-detail.json
│       │   ├── _schema-detail.json
│       │   ├── _suite-detail.json
│       │   ├── bearer+microsoft-silent.log
│       │   ├── local-only-answers.log
│       │   ├── local-only-interactive.log
│       │   ├── local-only-silent.log
│       │   ├── local+google-silent.log
│       │   ├── prompt-map.schema.log
│       │   └── suite-sentinel.log            # log of core suite functionality test
│       └── suite.log                         # summary log for the suite: docker/pg/cleanup and anchors
├── suite
│   ├── components
│   │   ├── area-detail.ts                    # append-only JSON steps (Suite/Schema)
│   │   ├── area-recorder.ts                  # facade for recording steps
│   │   ├── ci.ts                             # CI console rendering (icons, boxes, footers)
│   │   ├── constants.ts                      # shared labels and temp paths
│   │   ├── detail-io.ts                      # JSON artifact path helpers
│   │   ├── docker-suite.ts                   # Docker bring-up/cleanup helpers
│   │   ├── format.ts                         # pure formatting utilities
│   │   ├── logger.ts                         # structured step logging + box helpers
│   │   ├── pg-env.ts                         # SUITE_PG_* env read/publish helpers
│   │   ├── pg-suite.ts                       # Postgres container and schema helpers
│   │   ├── proc.ts                           # boxed subprocess execution/streaming
│   │   ├── scenario-status.ts                # per-scenario severity store (scaffold/env/files)
│   │   └── test-area.ts                      # per-area counts/state for reporter
│   ├── types
│   │   ├── ambient
│   │   │   ├── picomatch.d.ts                # shim types for picomatch if needed
│   │   │   └── vitest-reporter-ambient.d.ts  # maps 'vitest/reporter' Reporter type
│   │   ├── ci.ts                             # UI/icon type definitions
│   │   ├── fs-assert.ts                      # filesystem assertion types
│   │   ├── logger.ts                         # Logger type
│   │   ├── prompts.ts                        # interactive prompt types
│   │   ├── scenario-runner.ts                # scenario runner types
│   │   ├── scenarios.ts                      # scenario manifest types
│   │   ├── severity.ts                       # severity enums/types
│   │   └── ui.ts                             # UI icon mapping types
│   ├── global-setup.ts                       # suite bootstrap: Docker+Postgres, publish env
│   ├── sequencer.ts                          # (optional) custom test file ordering
│   └── vitest-reporter.ts                    # custom reporter: deterministic JSON-backed streaming
├── test
│   ├── components                            # assertion helpers used across tests
│   │   ├── auth-assert.ts                    # testing auth routes (planned)
│   │   ├── env-assert.ts                     # testing .env
│   │   ├── env-merge.ts                      # inject env with real settings (planned)
│   │   ├── fs-assert.ts                      # testing files as expected
│   │   ├── http-assert.ts                    # testing routes (not auth) (planned)
│   │   ├── interactive-driver.ts             # programmatic TTY driver for interactive flows
│   │   ├── pg-assert.ts                      # testing pg (planned)
│   │   ├── scaffold-command-assert.ts        # testing CLI command to scaffold
│   │   └── server-assert.ts                  # testing scaffolded app server (planned)
│   ├── e2e
│   │   ├── scenarios
│   │   │   ├── _runner
│   │   │   │   ├── scenario-runner.ts        # JSON-driven scenario executor
│   │   │   │   └── types.ts
│   │   │   ├── bearer+microsoft
│   │   │   │   ├── .real-env
│   │   │   │   │   └── .real.env             # real .env settings to be injected
│   │   │   │   ├── config
│   │   │   │   │   ├── answers.json          # answers for answers-file scenario
│   │   │   │   │   └── tests.json            # scenario mapping (title → scenarioName)
│   │   │   │   ├── manifest
│   │   │   │   │   ├── env.json              # expected env
│   │   │   │   │   ├── files.json            # expected files
│   │   │   │   │   └── routes.json           # expected routes
│   │   │   │   └── bearer+microsoft.test.ts  # scenario specific tests
│   │   │   ├── local-only
│   │   │   │   ├── .real-env
│   │   │   │   │   └── .real.env
│   │   │   │   ├── config
│   │   │   │   │   ├── answers.json
│   │   │   │   │   └── tests.json
│   │   │   │   ├── manifest
│   │   │   │   │   ├── env.json
│   │   │   │   │   ├── files.json
│   │   │   │   │   └── routes.json
│   │   │   │   └── local-only.test.ts
│   │   │   └── local+google
│   │   │       ├── .real-env
│   │   │       │   └── .real.env
│   │   │       ├── config
│   │   │       │   ├── answers.json
│   │   │       │   └── tests.json
│   │   │       ├── manifest
│   │   │       │   ├── env.json
│   │   │       │   ├── files.json
│   │   │       │   └── routes.json
│   │   │       └── local+google.test.ts
│   │   ├── schema
│   │   │   ├── config
│   │   │   │   └── prompt-map.schema.json    # JSON Schema for prompt-maps
│   │   │   ├── fixtures
│   │   │   │   └── prompt-map.json           # sample prompt map (validation input)
│   │   │   └── prompt-map.schema.test.ts     # validates prompt-map.json against schema
│   │   └── suite
│   │       └── suite.test.ts                 # suite sentinel test (Docker/PG/sanity)
│   └── global.d.ts                           # vitest globals
├── CHANGELOG.md
├── package.json
├── README.md
├── tsconfig.json
└── vitest.config.ts
```

---

## Typing & Validation

- Tests are **TypeScript**.
- Helpers export typed functions (e.g., `assertRoutes(baseUrl, manifest)`).
- Manifests as `*.json` + Zod schemas (optional) for shape validation.
- A `logger` module prints consistent `step/pass/fail` lines in both suite and scenarios.

---

## Logging & artifacts

- JSON artifacts written under `logs/<STAMP>/…` are authoritative:
  - `e2e/_suite-detail.json` — Suite step lines (append-only)
  - `e2e/_schema-detail.json` — Schema step lines (append-only)
  - `e2e/_scenario-detail.json` — per-scenario severities (fixed steps: scaffold/env/files)
  - `e2e/_vitest-summary.json` — per-file counts/durations
- **Monotonic step numbers**: `N) Title` is left-justified; details are indented.
- **Indent controls**: every `logger` method accepts `indent?: number | string` (`"+n"`/`"-n"` are relative).
- **Boxed subprocess output**: use `boxStart/boxLine/boxEnd` (via `proc.execBoxed`) for Docker and CLI runs.
- **Reporter links**: scenario logs emit `log: <path>`; the reporter prints a relative path and may also emit a `file://` URL in CI.
- **Terminology**: we use **“Postgres”** consistently in docs and logs.

---

## Docker & Postgres

- Single container per run, image: `postgres:16-alpine`.
- Random host port mapping (e.g., `5432 → 54xxx`) to avoid clashes.
- Suite publishes **`SUITE_PG_HOST|PORT|USER|PASS`**; tests read via `getSuitePgEnv()`.
- Readiness:
  - Prefer **Docker HEALTHCHECK** → `waitForHealthy(container)`.
  - For images without HEALTHCHECK, use **TCP** → `waitForTcp(host, port)`.
- Helpers:
  - `ensurePg()` → starts once per run, returns `{ env, containerName, stop() }`.
  - `withTempSchema(prefix, run)` → fast per-test isolation using schemas.
  - `createDb(name)`, `dropDb(name)` → strong isolation when the app owns the pool.
- (Planned) `mergeEnv(appDir, realEnvPath, extra, opts)` merges `.real-env/real.env` + suite PG env without clobbering OAuth or explicit `PORT` unless requested.

---

## CI Considerations

- Gate on Linux runners with Docker available.
- Cache `npm ci` only; never cache `.tmp/` scaffolds.
- Surface `logs/<date>/**` as CI artifacts on failures.

## Components

The detailed API for suite and test components now lives in **[`docs/components.md`](./components.md)**.

- **Suite components** (Docker + Postgres + logging) are implemented and documented there.
- **Test components** are listed with **Status: Planned** and proposed signatures. We’ll fill them in one by one as we agree on each piece.

Interactive scenarios are driven by **`test/components/interactive-driver.ts`**, which uses `openBoxedProcess` to stream a generator’s TTY output into the suite logs and programmatically answer prompts (including **checkbox lists** with scrolling and label-based selection).

> Conventions (applies to all components):
>
> - TypeScript everywhere; no sleeps; prefer readiness checks (Docker health + TCP).
> - Structured logs via `logger.ts` with `step/pass/fail`.
> - Keep exports lean; internal helpers stay unexported unless real scenarios need them.

---

## Assertion order

- **Scaffold** the app (silent / answers-file / interactive).
- **Assert `.env`** (always on the **unmerged** file).
- **Assert filesystem** via `manifest/files.json`:
  - **FAIL** on any missing required patterns or forbidden matches.
  - **WARN** on unexpected files (neither required nor forbidden), especially when `node_modules/**` and `.git/**` are ignored.
- (Merge step reserved for later.)

> Logging: filesystem results are summarized with compact counters and boxed lists (only when non-zero), e.g. **Missing files**, **Forbidden files found**, **Unexpected files found**.
