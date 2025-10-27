# kna-test-bed — Design

## Index

- [Goals](#goals)
- [Non-Goals](#non-goals)
- [Architecture Overview](#architecture-overview)
- [High-level flow](#high-level-flow)
- [Structure](#structure)
- [Typing & Validation](#typing--validation)
- [Logging & artifacts](#logging--artifacts)
- [Docker & Postgres](#docker--postgres)
- [CI Considerations](#ci-considerations)
- [Components](#components)
- [Assertion order](#assertion-order)
- [Future Components & Roadmap](#future-components--roadmap)
- [Output contract and runner updates](#output-contract-and-runner-updates)

---

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
- **Schema runner**: JSON-driven schema validation via `test/e2e/schema/_runner/schema-runner.ts`.
  - Reads `config/tests.json` (default) or `pre-release-tests/<version>/config/tests.json` (when `PRE_RELEASE_VERSION` is set; see `docs/pre-release-testing.md`)
  - Supports glob patterns to validate multiple files in a single test entry
  - Per-file schema override capability with optional `defaultSchema` fallback
  - Validates all test configuration files: prompt-map, scenario-tests, env-manifest, files-manifest, routes-manifest, answers
  - Records individual file validation results in `_schema-detail.json` for reporter streaming
- **Test helpers**: `test/components/*`
  - `scaffold-command-assert.ts`, `interactive-driver.ts`, `env-assert.ts`, `fs-assert.ts`
  - future: `server-assert.ts`
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
  - Scenario area header prints both the test file and the active `tests.json` as absolute `file:///` URLs (pre-release variant preferred when `PRE_RELEASE_VERSION` is set and present).
  - All log pointers are absolute `file:///` URLs.
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
  - **Assert .env** matches the scenario manifest (required keys **active**, optional keys **commented**). Output contract aligned with fs-assert: compact summaries, problem-only boxes, and a single final status line printed last.
  - Even if the **env** step is `FAIL`, the runner records severity and proceeds to the **files** step, then fails the scenario at the end (to maximize surfaced signal per run).

3. **globalTeardown**
   - Stop/remove the PG container (boxed `docker stop`/`rm` if used).
   - Close the suite logger and print a pointer to `logs/<stamp>`.
   - Write consolidated test summaries to `suite.log`:
     - **Schema tests**: Individual file validation results from `_schema-detail.json` with counts
     - **Scenario tests**: Per-scenario results from `_scenario-detail.json` with step-level detail

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
│       │   ├── schema-validation.log
│       │   └── suite-sentinel.log            # log of core suite functionality test
│       └── suite.log                         # summary log for the suite: docker/pg/cleanup and anchors
├── scripts
│   └── test-pre.mjs                          # helper: sets PRE_RELEASE_VERSION then runs Vitest
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
│   │   ├── pre-release.ts                    # pre-release version detection (env/npm args)
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
│   │   │   │   ├── pre-release-tests         # gitignored: version-specific test assets
│   │   │   │   │   └── x.y.z                 # e.g., 0.4.3, 1.0.0-beta (see docs/pre-release-testing.md)
│   │   │   │   │       ├── config            # version-specific config/answers
│   │   │   │   │       │   ├── tests.json
│   │   │   │   │       │   └── answers.json
│   │   │   │   │       └── manifest          # version-specific manifests
│   │   │   │   │           ├── env.json
│   │   │   │   │           ├── files.json
│   │   │   │   │           └── routes.json
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
│   │   │   ├── _runner
│   │   │   │   ├── schema-runner.ts          # JSON-driven schema validator
│   │   │   │   └── types.ts                  # schema test types
│   │   │   ├── config
│   │   │   │   ├── answers.schema.json       # JSON Schema for answers files
│   │   │   │   ├── env-manifest.schema.json  # JSON Schema for env manifests
│   │   │   │   ├── files-manifest.schema.json # JSON Schema for files manifests
│   │   │   │   ├── prompt-map.schema.json    # JSON Schema for prompt-maps
│   │   │   │   ├── routes-manifest.schema.json # JSON Schema for routes manifests
│   │   │   │   ├── scenario-tests.schema.json # JSON Schema for tests.json files
│   │   │   │   └── tests.json                # default schema test config (validates production files)
│   │   │   ├── fixtures
│   │   │   │   └── prompt-map-valid.json     # reference prompt-map (also used as scenario runner fallback)
│   │   │   ├── pre-release-tests             # gitignored: version-specific test assets
│   │   │   │   └── x.y.z                     # e.g., 0.4.3, 1.0.0-beta (see docs/pre-release-testing.md)
│   │   │   │       ├── config                # version-specific test config
│   │   │   │       │   └── tests.json
│   │   │   │       └── fixtures              # version-specific test fixtures (valid/invalid)
│   │   │   │           ├── *-valid.json
│   │   │   │           └── *-invalid-*.json
│   │   │   └── schema-validation.test.ts     # validates JSON files against schemas
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
> Logging: filesystem results are summarized with compact counters and boxed lists (only when non-zero), e.g. **Missing files**, **Forbidden files found**, **Unexpected files found**. The step header reads: “Files: validate files against manifest.” Missing manifest is handled with a clear “Manifest file not found:” line plus a boxed “Missing file” section, then the final `❌ fs-assert: FAIL`.

---

## Future Components & Roadmap

### Priority Order (v0.4.5–v0.7.0)

**v0.4.5 - Parallelism & Performance** (if CI output integrity maintained)

- Enable schema test parallelism (safe - order within Schema section doesn't matter)
- Enable scenario parallelism (only if cross-area output bleeding can be prevented)
- Maintain deterministic area ordering: Suite → Schema → Scenarios
- Critical: Ensure reporter doesn't interleave output from different test areas
- Interactive tests remain sequential (TTY conflicts)

**v0.5.0 - Server Infrastructure**

1. `env-merge.ts` - Merge real credentials + suite PG env into scaffolded `.env`
2. `server-assert.ts` - Start/stop server, readiness checks, graceful shutdown testing

**v0.6.0 - HTTP & Auth** 3. `http-assert.ts` - Public routes + static assets (favicon, CSS, content-type headers) 4. `auth-assert.ts` - Provider-aware auth flows (local/google/microsoft/bearer) 5. `session-assert.ts` - Session persistence across requests (separate module for clarity)

**v0.7.0 - Database** 6. `pg-assert.ts` - Database structure validation via nested JSON manifest

### Key Design Decisions

**Parallelism Strategy**

- **Schema tests**: Enable `test.concurrent` within schema-validation.test.ts
  - Order doesn't matter within the Schema section
  - All results still stream to `_schema-detail.json` for reporter
  - Safe because no shared state between schema validations
- **Scenario tests**: Enable per-scenario concurrency IF:
  - Reporter can buffer scenario results and emit them in deterministic order
  - No cross-contamination between Suite/Schema/Scenario output in CI logs
  - Each scenario writes to isolated temp directory (already true)
- **Interactive tests**: Always sequential (TTY/stdin conflicts)
- **Reporter constraint**: Must maintain Suite → Schema → Scenarios output order even with parallel execution

**Unified routes.json Manifest**

- Single `manifest/routes.json` contains public, protected, auth, and static asset routes
- Use `requiresAuth: boolean` flag to distinguish protected routes
- Use `headers` object for content-type and other header assertions
- Example:
  ```json
  {
    "routes": [
      { "path": "/", "method": "GET", "status": 200 },
      {
        "path": "/favicon.ico",
        "method": "GET",
        "status": 200,
        "headers": { "content-type": "image/x-icon" }
      },
      { "path": "/auth/login", "method": "POST", "status": 200 },
      { "path": "/account", "method": "GET", "status": 200, "requiresAuth": true }
    ]
  }
  ```

**Provider-Aware Auth (auth-assert.ts)**

- Single module handles all auth providers: local, google, microsoft, bearer
- Provider-specific helpers for different auth flows:
  - `assertLocalAuth()` - Direct form POST (register/login/logout)
  - `assertOAuthCallback()` - OAuth redirect flows (Google/Microsoft)
  - `assertBearerAuth()` - API key/token authentication
- Shared logic for post-authentication flows (protected routes, account management)
- Error handling built-in: invalid credentials, missing fields, CSRF failures

**Nested pg-assert.json Manifest**

- Tables contain columns, indexes, foreign keys, and test values as nested objects
- Supports primary keys, unique constraints, foreign key relationships
- Optional row count assertions and test data validation
- Example structure:
  ```json
  {
    "tables": {
      "users": {
        "required": true,
        "columns": {
          "id": { "type": "integer", "primaryKey": true },
          "email": { "type": "varchar", "unique": true }
        },
        "indexes": {
          "email_unique": { "columns": ["email"], "unique": true }
        },
        "foreignKeys": {},
        "values": { "minCount": 0 }
      },
      "sessions": {
        "required": true,
        "foreignKeys": {
          "fk_user": { "column": "user_id", "references": "users(id)" }
        }
      }
    }
  }
  ```

**Separate session-assert.ts Module**

- Smaller, focused modules over monolithic auth testing
- Tests session persistence independently from auth flows
- Validates: cookie storage, authenticated requests, session expiry
- Enables testing session edge cases without coupling to auth providers

**Server Lifecycle Management**

- `startServer()` boots once for all HTTP/auth/session tests
- Server runs continuously for efficiency during test execution
- `assertGracefulShutdown()` tests shutdown explicitly (stop/restart cycle)
- Final `stop()` in cleanup ensures no orphaned processes

**Error Handling Strategy**

- Built into each assert module, not separate components
- Each module tests both happy paths and error cases
- Examples:
  - `http-assert`: 400/401/403/404/500 status codes
  - `auth-assert`: Invalid credentials, CSRF, rate limiting
  - `server-assert`: Port conflicts, boot failures, timeout handling
  - `pg-assert`: Connection failures, missing tables/columns

---

## Output contract and runner updates

- Standardized output contract across env/files: single final status line printed last; problem-only boxes; compact section summaries.
- Env-assert supports `ignoreUnexpected` (suppresses only WARNs for unexpected keys). Value expectations (`equals`/`pattern`) apply to active keys and fail the step on mismatch.
- Runner continues to the files step after env `FAIL` and records step severities (`scaffold`, `env`, `files`) in `e2e/_scenario-detail.json`.
- Missing `.env` or manifest cases print a clear “not found” line and a boxed “Missing file” before the final `❌` line.
- CI reporter prints absolute file URLs, includes the active `tests.json` link under scenario headers, and surfaces concise cause notes (e.g., “required keys commented”, “optional keys active”, “env/files manifest not found”) in the consolidated suite summary.
