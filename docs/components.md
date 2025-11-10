# kna-test-bed — Components Reference

> This document is derived from the **actual code** and intended architecture in this repo.  
> Each entry lists **Status**, **Purpose**, **At a glance**, **Exports**, **Inputs/Outputs**, **Dependencies**, **Behavior & details**, **Error behavior**, and **Notes** (if useful).

> Status field convention: must be exactly one of — Implemented | Planned | Deprecated.

---

## Index

- Suite Components
  - [`suite/vitest-reporter.ts`](#suitevitest-reporterts)
  - [`suite/global-setup.ts`](#suiteglobal-setupts)
  - [`suite/components/constants.ts`](#suitecomponentsconstantsts)
  - [`suite/components/logger.ts`](#suitecomponentsloggerts)
  - [`suite/components/proc.ts`](#suitecomponentsprocts)
  - [`suite/components/docker-suite.ts`](#suitecomponentsdocker-suitets)
  - [`suite/components/pg-env.ts`](#suitecomponentspg-envts)
  - [`suite/components/pg-suite.ts`](#suitecomponentspg-suitets)
  - [`suite/components/scenario-status.ts`](#suitecomponentsscenario-statusts)
  - [`suite/components/ci.ts`](#suitecomponentscits)
  - [`suite/components/format.ts`](#suitecomponentsformatts)
  - [`suite/components/test-area.ts`](#suitecomponentstest-areats)
  - [`suite/components/detail-io.ts`](#suitecomponentsdetail-iots)
  - [`suite/components/area-detail.ts`](#suitecomponentsarea-detailts)
  - [`suite/components/area-recorder.ts`](#suitecomponentsarea-recorderts)

- Test Components
  - [`test/components/scaffold-command-assert.ts`](#testcomponentsscaffold-command-assertts)
  - [`test/components/interactive-driver.ts`](#testcomponentsinteractive-driverts)
  - [`test/components/test-constants.ts`](#testcomponentstest-constantsts)
  - [`test/components/env-assert.ts`](#testcomponentsenv-assertts)
  - [`test/components/fs-assert.ts`](#testcomponentsfs-assertts)

- Scenario Runner
  - [`test/e2e/scenarios/_runner/types.ts`](#teste2escenarios_runnertypests)
  - [`test/e2e/scenarios/_runner/scenario-runner.ts`](#teste2escenarios_runnerscenario-runnerts)

- Schema Runner
  - [`test/e2e/schema/_runner/types.ts`](#teste2eschema_runnertypests)
  - [`test/e2e/schema/_runner/schema-runner.ts`](#teste2eschema_runnerschema-runnerts)

- Planned Components
  - [`test/components/env-merge.ts`](#testcomponentsenv-mergets-planned)
  - [`test/components/server-assert.ts`](#testcomponentsserver-assertts-planned)
  - [`test/components/http-assert.ts`](#testcomponentshttp-assertts-planned)
  - [`test/components/auth-assert.ts`](#testcomponentsauth-assertts-planned)
  - [`test/components/session-assert.ts`](#testcomponentssession-assertts-planned)
  - [`test/components/pg-assert.ts`](#testcomponentspg-assertts-planned)

---

## suite/vitest-reporter.ts

**Status:** Implemented

**Purpose**  
Deterministic, progressive streaming of Suite → Schema → Scenarios using JSON-backed detail files. Prints absolute file URLs, includes the active config for scenario areas, and emits immediate log links and footers without pauses.

**At a glance**

| Behavior               | Notes                                                                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quiet by default       | No per-file text unless enabled (see Controls).                                                                                                                                                                             |
| Controls               | Enable text with `--verbose`/`-v` or `KNA_VITEST_TEXT=1`.                                                                                                                                                                   |
| JSON artifacts         | Always writes `e2e/_vitest-summary.json`. Reads `e2e/_suite-detail.json`, `e2e/_schema-detail.json`, and `e2e/_scenario-detail.json` to stream step lines and compute accurate counts (including skip).                     |
| Order                  | Activates and streams in a stable order: Suite → Schema → Scenarios.                                                                                                                                                        |
| Scenario header extras | Scenario area header prints two absolute file URLs: the test file and the active `tests.json` config (pre-release variant preferred when `PRE_RELEASE_VERSION` is set and exists).                                          |
| Absolute log links     | All emitted log pointers are absolute `file:///` URLs (Windows-safe; spaces percent-encoded).                                                                                                                               |
| Per-test step lines    | Each test prints a bullet `• Testing <scenario>...` and step lines derived from `_scenario-detail.json`: `scaffold`, `env manifest checks`, `files manifest checks` (plus a `↩️ mergeEnv: skipped` when present in config). |
| Robust                 | Ignores taskless console noise; never throws; prints default log links if tests forget to emit one; de-duplicates repeated log lines while still surfacing late arrivals before area footers.                               |

**Exports**

```ts
export default class TestReporter {
  /* Vitest v3 reporter */
}
```

**Inputs/Outputs**  
Consumes runner events; writes to `suite.log`; reads/writes JSON detail artifacts under `logs/<STAMP>/…`.

**Dependencies**  
`path`, `url`, `suite/components/logger.ts`, `suite/components/detail-io.ts`, `suite/components/ci.ts`, `suite/components/constants.ts`

**Behavior & details**  
Prints group bullets, then step lines as they appear in JSON, then a summary + immediate log link + footer. Scenario areas also render the active `tests.json` link under the header. De-duplicates log pointers and closes areas promptly to avoid trailing pauses. Pre-release mapping ensures `it` → `testGroupName` is resolved from the preferred config when `PRE_RELEASE_VERSION` is set.

**Error behavior**  
Never throws; drops lines on hard failures.

---

## suite/global-setup.ts

**Status:** Implemented

**Purpose**  
Vitest global setup: prepare Docker + Postgres, stamp logs, publish env, and return teardown.

**At a glance**

| Phase    | Actions                                                                             |
| -------- | ----------------------------------------------------------------------------------- |
| Setup    | Docker check → stale cleanup → ensure image → run container → probes                |
| Publish  | `KNA_LOG_STAMP`, `SUITE_PG_HOST`, `SUITE_PG_PORT`, `SUITE_PG_USER`, `SUITE_PG_PASS` |
| Teardown | Stop container, close log, print logs pointer                                       |

**Exports**

```ts
export default async function globalSetup(): Promise<void | (() => Promise<void>)>;
```

**Inputs/Outputs**  
Writes `logs/<stamp>/suite.log`, sets env, returns teardown.

**Dependencies**  
`./components/logger.ts`, `./components/docker-suite.ts`, `./components/pg-suite.ts`

**Behavior & details**  
Emits a clear “Run Tests” anchor for the reporter; prints a pointer to logs root at the end.

**Error behavior**  
Logs fail lines and still returns a teardown that prints the logs pointer.

---

## suite/components/constants.ts

**Status:** Implemented

**Purpose**  
Centralized infrastructure constants for filenames, patterns, directories, environment variables, and default paths. Single source of truth for all hardcoded strings used across the test suite.

**At a glance**

| Category                   | Constants                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Docker/temp                | `KNA_LABEL`, `TMP_DIR_NAME`, `KNA_TMP_DIR`                                               |
| Reporter bullets           | `SUITE_BULLET`, `SCHEMA_BULLET`                                                          |
| JSON artifact filenames    | `SUITE_DETAIL_FILE`, `SCHEMA_DETAIL_FILE`, `SCENARIO_DETAIL_FILE`, `VITEST_SUMMARY_FILE` |
| Log filenames              | `SUITE_LOG_FILE`, `SCHEMA_LOG_FILE`                                                      |
| Test patterns (regex)      | `SUITE_TEST_PATTERN`, `SCHEMA_TEST_PATTERN`, `SCENARIO_TEST_PATTERN`                     |
| Directory paths            | `LOGS_DIR`, `E2E_DIR`, `TEST_E2E_DIR`, `SCHEMA_CONFIG_DIR`, `SCHEMA_FIXTURES_DIR`        |
| Environment variable names | `ENV_LOG_STAMP`, `ENV_PRE_RELEASE_VERSION`, `ENV_SCENARIO_CONFIG`                        |
| Default paths              | `DEFAULT_PROMPT_MAP`                                                                     |

**Exports**

```ts
// Docker/temp
export const KNA_LABEL: string;
export const TMP_DIR_NAME: string;
export const KNA_TMP_DIR: string;

// Reporter bullets
export const SUITE_BULLET: string;
export const SCHEMA_BULLET: string;

// JSON artifact filenames
export const SUITE_DETAIL_FILE: string; // "_suite-detail.json"
export const SCHEMA_DETAIL_FILE: string; // "_schema-detail.json"
export const SCENARIO_DETAIL_FILE: string; // "_scenario-detail.json"
export const VITEST_SUMMARY_FILE: string; // "_vitest-summary.json"

// Log filenames
export const SUITE_LOG_FILE: string; // "suite-sentinel.log"
export const SCHEMA_LOG_FILE: string; // "schema-validation.log"

// Test patterns
export const SUITE_TEST_PATTERN: RegExp; // /suite\.test\.ts$/i
export const SCHEMA_TEST_PATTERN: RegExp; // /schema.*\.test\.ts$/i
export const SCENARIO_TEST_PATTERN: RegExp; // /scenarios\/.*\.test\.ts$/i

// Directory paths
export const LOGS_DIR: string; // "logs"
export const E2E_DIR: string; // "e2e"
export const TEST_E2E_DIR: string; // "test/e2e"
export const SCHEMA_CONFIG_DIR: string; // "test/e2e/schema/config"
export const SCHEMA_FIXTURES_DIR: string; // "test/e2e/schema/fixtures"

// Environment variable names
export const ENV_LOG_STAMP: string; // "KNA_LOG_STAMP"
export const ENV_PRE_RELEASE_VERSION: string; // "PRE_RELEASE_VERSION"
export const ENV_SCENARIO_CONFIG: string; // "SCENARIO_CONFIG"

// Default paths
export const DEFAULT_PROMPT_MAP: string; // "test/e2e/schema/fixtures/prompt-map-valid.json"
```

**Inputs/Outputs**  
Reads optional env vars for `KNA_TMP_DIR`; no other I/O.

**Dependencies**  
None

**Behavior & details**  
Used throughout the test suite for consistent naming and path resolution:

- Reporter uses patterns to detect test types and match filenames for box closing
- Sequencer uses patterns to enforce test execution order
- Detail I/O uses filenames and directory paths to read/write JSON artifacts
- Schema runner uses config/fixtures directories for test resolution
- Global setup uses log filenames for suite-level logging

**Error behavior**  
N/A (constants only)

**Notes**  
As of v0.4.4, all infrastructure strings are centralized here (18 constants total). This prevents bugs from stale references and provides a single source of truth for path/pattern changes.

---

## suite/components/logger.ts

**Status:** Implemented

**Purpose**  
Structured, append-only logging with steps and boxed sections. Path builders + scenario logger from the run stamp.

**At a glance**

| Capability      | Notes                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| Steps           | `step()`, `pass()`, `**warn()**`, `fail()`, `write()` with indent controls |
| Boxes           | `boxStart/boxLine/boxEnd` for aligned subprocess output                    |
| Paths           | `buildLogRoot`, `buildSuiteLogPath`, `buildScenarioLogPath`                |
| Scenario logger | `scenarioLoggerFromEnv` requires `KNA_LOG_STAMP` (set by `global-setup`)   |

**Exports**

```ts
export type Logger = {
  filePath: string;
  step: (title: string, details?: string, indent?: number | string) => void;
  pass: (msg?: string, indent?: number | string) => void;
  warn: (msg: string, indent?: number | string) => void;
  fail: (msg: string, indent?: number | string) => void;
  write: (line: string, indent?: number | string) => void;

  // Box helpers
  boxStart: (title: string, opts?: { width?: number; indent?: number | string }) => void;
  boxLine: (line: string, opts?: { width?: number; indent?: number | string }) => void;
  boxEnd: (
    label: string,
    opts?: { width?: number; indent?: number | string; suffix?: string },
  ) => void;

  close: () => Promise<void>;
};

export const STEP_DETAIL_INDENT: number;

export function withIndent(base: Logger, indent: number | string): Logger;
export function createLogger(filePath: string): Logger;

export function makeLogStamp(d?: Date): string;
export function sanitizeLogName(name: string): string;
export function buildLogRoot(stamp: string): string;
export function buildSuiteLogPath(stamp: string): string;
export function buildScenarioLogPath(stamp: string, scenario: string): string;
export function scenarioLoggerFromEnv(scenario: string): Logger;
```

**Inputs/Outputs**  
Outputs log files under `logs/<STAMP>/**`.

**Dependencies**  
`fs-extra`, `path`

**Behavior & details**

- Monotonic steps; stable indentation; **pass** prefixes `✅`; **`warn()`** prefixes `⚠️`; **fail** prefixes `❌`.
- Boxes draw clean frames; safe for mixed stdout/stderr content.

**Error behavior**  
Throws if `scenarioLoggerFromEnv` is used without `KNA_LOG_STAMP`.

---

## suite/components/proc.ts

**Status:** Implemented

**Purpose**  
Unified subprocess execution and streaming with **boxed logging** and ANSI-safe output.

**At a glance**

| Mode/Helper       | API                | Use when…                                           |
| ----------------- | ------------------ | --------------------------------------------------- |
| Buffered          | `execBoxed`        | Capture stdout and log a tidy boxed transcript      |
| Streaming/Tty     | `openBoxedProcess` | You need stdin + live output (interactive flows)    |
| Boxed blob writer | `logBox`           | Print a custom boxed block (e.g., annotated `.env`) |
| Boxed list+footer | `logBoxCount`      | Lists with a bottom label like `└─ 10 files ─`      |

**Exports**

```ts
export type SimpleExec = { stdout: string; exitCode: number };

export type ExecBoxedOptions = {
  title?: string;
  markStderr?: boolean;
  windowsHide?: boolean;
  argsWrapWidth?: number;
} & import('execa').Options;

export type OpenBoxedOpts = {
  title?: string;
  windowsHide?: boolean;
  cwd?: string;
  env?: Record<string, string | undefined>;
};

export type RunningProc = {
  stdin: NodeJS.WritableStream | null | undefined;
  stdout: NodeJS.ReadableStream | null | undefined;
  stderr: NodeJS.ReadableStream | null | undefined;
  wait: () => Promise<{ exitCode: number }>;
};

export async function execBoxed(
  log: Logger | undefined,
  cmd: string,
  args: string[],
  opts?: ExecBoxedOptions,
): Promise<SimpleExec>;

export function openBoxedProcess(
  log: Logger | undefined,
  cmd: string,
  args?: string[],
  opts?: OpenBoxedOpts,
): { proc: RunningProc; closeBox: (exitCode?: number) => void };

/** Generic boxed section helper (used by env-assert annotated dumps). */
export function logBox(
  log: Logger | undefined,
  title: string,
  lines: string[],
  legend?: string[],
  width?: number,
): void;

/** Box helper for lists with a bottom label (house style). */
export function logBoxCount(
  log: Logger | undefined,
  title: string,
  lines: string[],
  footerLabel: string,
  opts?: { width?: number; indent?: number | string },
): void;
```

**Inputs/Outputs**  
Spawns `execa`; yields boxed logs and child handles.

**Dependencies**  
`execa`, `suite/components/logger.ts`

**Behavior & details**

- Boxes **open on first output** and **close with exit code**.
- Streaming path strips ANSI/cursor codes for readable logs.
- `argsWrapWidth` produces compact but readable `args=[…]`.

**Error behavior**  
Non-zero exits are returned; callers choose whether to throw.

---

## suite/components/docker-suite.ts

**Status:** Implemented

**Purpose**  
Docker helpers: availability checks, image pulls, run/stop/remove, inspect, and readiness probes.

**At a glance**

| Category  | Items                                                                |
| --------- | -------------------------------------------------------------------- |
| Lifecycle | `ensureDocker`, `runContainer`, `stopContainer`, `removeContainer`   |
| Utilities | `uniqueName`, `pullImage`, `inspect`, `removeByLabel`, `getFreePort` |
| Readiness | `waitForHealthy`, `waitForTcp`                                       |
| Ports     | `getHostPort` on a handle                                            |

**Exports**

```ts
import type { Logger } from './logger.ts';

export async function ensureDocker(log?: Logger): Promise<void>;
export function uniqueName(prefix: string): string;
export async function waitForTcp(
  host: string,
  port: number,
  timeoutMs?: number,
  log?: Logger,
): Promise<void>;
export async function pullImage(image: string, log?: Logger): Promise<void>;

export type PublishSpec = { containerPort: number; hostPort?: number; host?: string };
export type RunContainerOptions = {
  name?: string;
  image: string;
  env?: Record<string, string | number | boolean>;
  publish?: PublishSpec[];
  args?: string[];
  preArgs?: string[];
  detach?: boolean;
  removeOnStop?: boolean;
  network?: string;
  log?: Logger;
};

export async function runContainer(opts: RunContainerOptions): Promise<{
  name: string;
  stop: () => Promise<void>;
  remove: () => Promise<void>;
  inspect: () => Promise<any>;
  getHostPort: (containerPort: number) => Promise<number | null>;
}>;

export async function inspect(name: string): Promise<any>;
export async function waitForHealthy(name: string, log?: Logger, timeoutMs?: number): Promise<void>;
export async function removeByLabel(label: string, log?: Logger): Promise<void>;
export async function getFreePort(): Promise<number>;
export async function stopContainer(name: string): Promise<void>;
export async function removeContainer(name: string): Promise<void>;
export async function isRunning(name: string): Promise<boolean>;
export async function getHostPort(name: string, containerPort: number): Promise<number | null>;
```

**Inputs/Outputs**  
Spawns `docker`; returns container handles with helpers.

**Dependencies**  
`execa`, Node `net`, `crypto`, `suite/components/proc.ts`, `suite/components/logger.ts`

**Behavior & details**

- `runContainer` auto-pulls images and exposes helper ops on the handle.
- `waitForHealthy` honors image HEALTHCHECK; use `waitForTcp` otherwise.

**Error behavior**  
Clear exceptions for missing Docker/daemon, timeouts, CLI failures.

---

## suite/components/pg-env.ts

**Status:** Implemented

**Purpose**  
Stable shape for suite-level Postgres env and a reader of `SUITE_PG_*` published by `global-setup`.

**At a glance**

| Key     | Source env          |
| ------- | ------------------- |
| PG_HOST | SUITE_PG_HOST       |
| PG_PORT | SUITE_PG_PORT (num) |
| PG_USER | SUITE_PG_USER       |
| PG_PASS | SUITE_PG_PASS       |

**Exports**

```ts
export type PgEnv = { PG_HOST: string; PG_PORT: number; PG_USER: string; PG_PASS: string };
export function getSuitePgEnv(): PgEnv;
```

**Inputs/Outputs**  
Reads `process.env.SUITE_PG_*`.

**Dependencies**  
None

**Behavior & details**  
Intentionally omits `PG_DB`; tests set per-scenario DB names.

**Error behavior**  
Reader doesn’t throw; downstream code will surface missing values.

---

## suite/components/pg-suite.ts

**Status:** Implemented

**Purpose**  
Bring up **one** Postgres container for the run; provide per-test isolation via **schemas** or **databases**.

**At a glance**

| Feature      | API                                         |
| ------------ | ------------------------------------------- |
| Bring-up     | `ensurePg` → `{ env, containerName, stop }` |
| Per-schema   | `withTempSchema(prefix, run)`               |
| Per-database | `createDb(name)`, `dropDb(name)`            |

**Exports**

```ts
import type { Logger } from './logger.ts';
import type { PgEnv } from './pg-env.ts';

export type PgHandle = { env: PgEnv; containerName: string; stop(): Promise<void> };

export async function ensurePg(log?: Logger, opts?: { clean?: boolean }): Promise<PgHandle>;

export async function withTempSchema<T>(
  prefix: string,
  run: (utils: {
    schema: string;
    connect: () => Promise<import('pg').Client>;
    searchPathSql: string;
  }) => Promise<T>,
  log?: Logger,
): Promise<T>;

export async function createDb(dbName: string, log?: Logger): Promise<void>;
export async function dropDb(dbName: string, log?: Logger): Promise<void>;
```

**Inputs/Outputs**  
Spawns Docker; connects via `pg`; returns env + lifecycle helpers.

**Dependencies**  
`pg`, `suite/components/docker-suite.ts`, `suite/components/logger.ts`, `suite/components/pg-env.ts`, `suite/components/constants.ts`

**Behavior & details**

- `ensurePg` is idempotent per run.
- Per-schema mode is fast; per-database is strongest isolation.

**Error behavior**  
Throws on Docker/health/TCP/SQL issues; logs details.

---

## suite/components/scenario-status.ts

**Status:** Implemented

**Purpose**  
Record per-scenario per-step severity into the JSON detail artifact consumed by the reporter.

**At a glance**

| Concept     | Meaning                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| Steps       | `scaffold`, `env`, `files`                                                                                    |
| Severities  | `ok`, `warn`, `fail` (worst-of merge per step; skip is handled by the reporter via Vitest, not recorded here) |
| Store shape | `{ [testGroupName]: { [step]: { severity, meta? } } }`                                                        |

**Exports**

```ts
export type ScenarioSeverity = 'ok' | 'warn' | 'fail';
export type ScenarioStep = 'scaffold' | 'env' | 'files';
export type ScenarioDetailMeta = {
  missingCount?: number;
  breachCount?: number;
  unexpectedCount?: number;
  note?: string;
};
export function recordScenarioSeverityFromEnv(
  scenario: string,
  next: ScenarioSeverity,
  opts?: { step?: ScenarioStep; meta?: ScenarioDetailMeta },
): void;
```

**Inputs/Outputs**  
Reads current run stamp from env; updates `logs/<STAMP>/e2e/_scenario-detail.json` (append/merge).

**Dependencies**  
[`suite/components/detail-io.ts`](#suitecomponentsdetail-iots), `fs-extra`, `path`

**Behavior & details**

- Merges severity by worst-of for each step to preserve failures.
- When called without an explicit `step`, defaults to projecting onto `env` for back-compat.

**Error behavior**  
No-ops if stamp missing; write errors propagate.

---

## suite/components/ci.ts

**Status:** Implemented

**Purpose**  
Shared console helpers used by the reporter to render tidy, consistent output in the terminal (icons, boxed sections, aligned footers).

**At a glance**

| Capability | Notes                                                             |
| ---------- | ----------------------------------------------------------------- |
| Icons      | Centralized mapping via `suite/types/ui.ts` for ok/warn/fail/skip |
| Boxes      | `boxStart/boxLine/boxEnd` with width/indent control               |
| Steps      | `testStep`, `suiteStep`, `schemaStep` render standard bullets     |
| Groups     | `testAreaStart/End` prints a header and a footer with counts      |

**Exports**

```ts
export function createCI(): import('../types/ci.ts').CI;
```

**Inputs/Outputs**  
Writes human-readable lines to stdout only. No file I/O.

**Dependencies**  
`../types/ci.ts`, `../types/ui.ts`, and internal helpers. Used by the reporter.

**Behavior & details**

- Consistent box drawing with adjustable width/indent.
- Safe to call multiple times; group headers are idempotent per test area.
- Scenario helpers (`scenarioOpen/…/scenarioCloseSummary`) produce compact group summaries.

**Error behavior**  
Never throws by design; `close()` resolves immediately.

---

## suite/components/format.ts

**Status:** Implemented

**Purpose**  
Pure formatting helpers shared by `ci.ts` and `logger.ts` for box rules and indentation.

**At a glance**

| Helper              | Purpose                          |
| ------------------- | -------------------------------- |
| `DEFAULT_BOX_WIDTH` | Standard width for boxed output  |
| `fitLabel`          | Truncate labels without ellipsis |
| `makeRule`          | Build top/bottom rule lines      |
| `resolveIndent`     | Normalize indent value           |

**Exports**

```ts
export const DEFAULT_BOX_WIDTH: number;
export function fitLabel(label: string, maxLen: number): string;
export function makeRule(openGlyph: '┌' | '└', label: string, width: number): string;
export function resolveIndent(indent: string | number | undefined, defaultIndent: string): string;
```

**Inputs/Outputs**  
Pure; no IO.

**Dependencies**  
None

**Behavior & details**  
Used to keep box drawing consistent and prevent overflows.

**Error behavior**  
N/A

---

## suite/components/test-area.ts

**Status:** Implemented

**Purpose**  
Lightweight model for a test “area” used by `ci.ts` to track headers, steps, and footer counts.

**At a glance**

| Property/Method       | Description                                   |
| --------------------- | --------------------------------------------- |
| `TestArea.absFileUrl` | Make file:/// URL from abs path               |
| `TestArea.relFileUrl` | Make relative file URL for logs               |
| `addStep`             | Push a step and update counts                 |
| `getCounts`           | Retrieve `{ total, passed, failed, skipped }` |

**Exports**

```ts
export type TestAreaCounts = { total: number; passed: number; failed: number; skipped: number };
export class TestArea {
  /* ctor(title,filePath,indent?), helpers, counts */
}
```

**Inputs/Outputs**  
Pure model; no external IO.

**Dependencies**  
`path`, [`suite/types/severity.ts`](#suitecomponentsscenario-statusts)

**Behavior & details**  
Encapsulates URLs and counters for consistent CI rendering.

**Error behavior**  
N/A

---

## suite/components/detail-io.ts

**Status:** Implemented

**Purpose**  
Shared helpers for reading/writing JSON detail artifacts and computing their paths from the current run stamp.

**At a glance**

| Helper                 | Purpose                             |
| ---------------------- | ----------------------------------- |
| `stampFromEnv()`       | Read current run stamp from env     |
| `loadJsonSafe()`       | Read JSON with a safe fallback      |
| `saveJson()`           | Ensure dir and write pretty JSON    |
| `suiteDetailPath()`    | Path to `e2e/_suite-detail.json`    |
| `schemaDetailPath()`   | Path to `e2e/_schema-detail.json`   |
| `scenarioDetailPath()` | Path to `e2e/_scenario-detail.json` |

**Exports**

```ts
export function stampFromEnv(): string | null;
export function ensureDir(p: string): void;
export function loadJsonSafe<T>(p: string, fallback: T): T;
export function saveJson(p: string, data: any): void;
export function suiteDetailPath(): string | null; // logs/<STAMP>/e2e/_suite-detail.json
export function schemaDetailPath(): string | null; // logs/<STAMP>/e2e/_schema-detail.json
export function scenarioDetailPath(): string | null; // logs/<STAMP>/e2e/_scenario-detail.json
```

**Inputs/Outputs**  
Reads `process.env.KNA_LOG_STAMP` to derive the current run stamp. Loads and writes JSON files under `logs/<STAMP>/…`.

**Dependencies**  
`fs-extra`, `path`, [`suite/components/logger.ts`](#suitecomponentsloggerts) (`buildLogRoot`)

**Behavior & details**

- `stampFromEnv()` returns `null` when no stamp is present (e.g., outside tests).
- `loadJsonSafe(p, fallback)` returns `fallback` on any read/parse error.
- `saveJson(p, data)` ensures the parent directory exists and writes pretty JSON (2-space indent).
- Path helpers return `null` if the stamp is missing.

**Error behavior**  
Never throws on read; returns `fallback`. Write errors from `saveJson` will surface (no swallow) to signal disk problems.

**Notes**  
These artifacts are the single source of truth for streaming counts in the reporter.

---

## suite/components/area-detail.ts

**Status:** Implemented

**Purpose**  
Append-only recorders for non-scenario areas: Suite and Schema.

**At a glance**

| API                | Effect                                                   |
| ------------------ | -------------------------------------------------------- |
| `recordSuiteStep`  | Append `{severity,message}` to `e2e/_suite-detail.json`  |
| `recordSchemaStep` | Append `{severity,message}` to `e2e/_schema-detail.json` |

**Exports**

```ts
export type AreaStep = { severity: import('../types/severity.ts').Sev; message: string };
export function recordSuiteStep(severity: Sev, message: string): void;
export function recordSchemaStep(severity: Sev, message: string): void;
```

**Inputs/Outputs**  
Writes JSON arrays in the current run’s logs folder. No console output.

**Dependencies**  
[`suite/components/detail-io.ts`](#suitecomponentsdetail-iots), [`suite/types/severity.ts`](#suitecomponentsscenario-statusts)

**Behavior & details**  
Appends steps to `e2e/_suite-detail.json` and `e2e/_schema-detail.json`. Supports severities: `ok | warn | fail | skip`.

**Error behavior**  
If no `KNA_LOG_STAMP` is present, the functions are no-ops. Write errors propagate to the caller.

---

## suite/components/area-recorder.ts

**Status:** Implemented

**Purpose**  
Lightweight façade re-exporting the scenario/non-scenario step recorders for convenient imports in tests.

**At a glance**

| Export             | From                                  |
| ------------------ | ------------------------------------- |
| `recordSuiteStep`  | `suite/components/area-detail.ts`     |
| `recordSchemaStep` | `suite/components/area-detail.ts`     |
| Scenario recorders | `suite/components/scenario-status.ts` |

**Exports**  
Re-exports from `area-detail.ts` and `scenario-status.ts`.

**Inputs/Outputs**  
None at module level; acts as a façade only.

**Dependencies**  
`./area-detail.ts`, `./scenario-status.ts`

**Behavior & details**  
Provides a stable import surface (`area-recorder`) so tests don’t need to know individual module paths.

**Error behavior**  
N/A (re-exports only).

---

## test/components/scaffold-command-assert.ts

**Status:** Implemented

**Purpose**  
Run the Kickstart CLI to a **temp dir** and capture a boxed transcript. Supports silent, answers-file, and **interactive (driver-driven)**.

**At a glance**

| Aspect       | Behavior                                                                   |
| ------------ | -------------------------------------------------------------------------- |
| Temp root    | `KNA_TMP_DIR` or repo `.tmp/`                                              |
| Answers-file | If provided, flags are ignored (non-interactive)                           |
| Interactive  | If prompts provided, uses `interactive-driver` (no manual TTY)             |
| Logging      | Wrapped `cmd/args` + boxed generator output; emits `[SCENARIO_LOG] <path>` |

**Exports**

```ts
export type Prompt = import('./interactive-driver.ts').Prompt;

export type ScaffoldCmdOpts = {
  testGroupName: string;
  flags?: string[];
  answersFile?: string;
  interactive?: { prompts?: Prompt[] };
  log?: import('../../suite/components/logger.ts').Logger;
  subcommand?: string; // default "web"
  generator?:
    | { kind: 'linked'; spec: string }
    | { kind: 'node'; entry: string }
    | { kind: 'npx'; spec: string };
};

export type ScaffoldResult = {
  appDir: string;
  logPath: string;
  cleanup: () => Promise<void>;
};

export async function assertScaffoldCommand(opts: ScaffoldCmdOpts): Promise<ScaffoldResult>;
```

**Inputs/Outputs**  
Spawns generator; returns `appDir`, `logPath`, `cleanup()`.

**Dependencies**  
`fs-extra`, `execa`, `suite/components/logger.ts`, `suite/components/constants.ts`, `suite/components/proc.ts`, `./interactive-driver.ts`

**Behavior & details**  
Interactive path uses `openBoxedProcess`. Silent/answers paths use `execBoxed`.

**Error behavior**  
Throws on non-zero exit, pre-existing app dir, or spawn failure.

---

## test/components/interactive-driver.ts

**Status:** Implemented

**Purpose**  
Automate **interactive** CLI runs (text and checkbox prompts) with robust screen parsing, scrolling, and toggling.

**At a glance**

| Prompt type | Action                                                                        |
| ----------- | ----------------------------------------------------------------------------- |
| Text        | Wait for `expect` (RegExp), then `send`                                       |
| Checkbox    | Parse visible list, scroll with ↑/↓, toggle labels by text, optionally submit |

**Exports**

```ts
export type TextPrompt = {
  expect: RegExp;
  send: string; // include '\n' if needed
  timeoutMs?: number; // default 15000
  type?: 'text';
};

export type CheckboxPrompt = {
  type: 'checkbox';
  expect: RegExp;
  select: string[];
  submit?: boolean; // default true
  timeoutMs?: number; // default 20000
  required?: boolean; // throw if not found after scan
  maxScroll?: number; // default 2000
};

export type Prompt = TextPrompt | CheckboxPrompt;

export type RunInteractiveOpts = {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  prompts: Prompt[];
  logger?: import('../../suite/components/logger.ts').Logger;
  logTitle?: string;
  windowsHide?: boolean;
};

export type RunInteractiveResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOutAt?: number; // index of the prompt that timed out
};

export async function runInteractive(opts: RunInteractiveOpts): Promise<RunInteractiveResult>;
```

**Inputs/Outputs**  
Consumes `Prompt[]`; returns buffers + `exitCode` (+ `timedOutAt` on timeout).

**Dependencies**  
`suite/components/proc.ts (openBoxedProcess)`, `suite/components/logger.ts`

**Behavior & details**

- ANSI stripping for robust matching.
- Diagnostics on timeout:
  - Prompts **responded to**
  - Prompts **seen but not expected**
  - Prompts **expected but not seen**
  - Final timeout line

**Error behavior**  
Returns normally with `timedOutAt` set to the prompt index on timeout (does not throw). The caller (`scaffold-command-assert.ts`) checks `timedOutAt` and throws an error with diagnostic information. Checkbox can throw if `required` is true and labels are not found after scan.

**Notes**  
As of v0.4.3, the scaffold assertion properly detects timeouts via the `timedOutAt` field and reports them as test failures with clear diagnostic output.

---

## test/components/test-constants.ts

**Status:** Implemented

**Purpose**  
Centralized timeout constants for test infrastructure. Single source of truth for per-prompt and test-level timeout values.

**At a glance**

| Constant                     | Value   | Purpose                                               |
| ---------------------------- | ------- | ----------------------------------------------------- |
| `PROMPT_TIMEOUT_MS`          | 15_000  | Default timeout for text/confirm prompts (15 seconds) |
| `PROMPT_CHECKBOX_TIMEOUT_MS` | 20_000  | Timeout for checkbox menu prompts (20 seconds)        |
| `SCHEMA_TEST_TIMEOUT_MS`     | 60_000  | Test-level timeout for schema validation (1 minute)   |
| `SCENARIO_TEST_TIMEOUT_MS`   | 180_000 | Test-level timeout for scenario tests (3 minutes)     |

**Exports**

```ts
export const PROMPT_TIMEOUT_MS: number;
export const PROMPT_CHECKBOX_TIMEOUT_MS: number;
export const SCHEMA_TEST_TIMEOUT_MS: number;
export const SCENARIO_TEST_TIMEOUT_MS: number;
```

**Inputs/Outputs**  
Pure constants; no I/O.

**Dependencies**  
None

**Behavior & details**

- Used by `interactive-driver.ts` for per-prompt default timeouts (fallback when `timeoutMs` not specified in prompt).
- Used by `scenario-runner.ts` for test-level timeout (Vitest `test(..., timeout)`) and per-prompt defaults.
- Used by `schema-runner.ts` for test-level timeout.
- Scenario timeout increased from 120s to 180s in v0.4.4 to prevent false failures on interactive tests.

**Error behavior**  
N/A (constants only)

**Notes**  
As of v0.4.4, all timeout values are centralized in this file for easy discovery and maintenance.

---

## test/components/env-assert.ts

**Status:** Implemented

**Purpose**  
Validate the **unmerged** `.env` against a manifest:

- `required` keys must be **active** (uncommented)
- `optional` keys must be present but **commented** (not active)
- Optional `expect` allows **value checks** on active keys (`equals` / `pattern`)
- Optional `ignoreUnexpected` lists keys to suppress WARN when they are unexpected

**At a glance**

| Feature            | Notes                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------- | --------------------- | --------------------- |
| Parse & diff       | Distinguishes active vs commented assignments                                                            |
| Summaries          | Discovery line + section lines (Required/Optional/Other)                                                 |
| Problem-only boxes | “Missing required keys”, “Commented required keys”, “Missing optional keys”, “Active optional keys”, etc |
| Final status last  | Single final line: `✅ env-assert: OK`                                                                   | `⚠️ env-assert: WARN` | `❌ env-assert: FAIL` |
| Debug (optional)   | `E2E_DEBUG_ENV_ASSERT=1` prints an annotated `.env` box                                                  |

**Exports**

```ts
export async function assertEnvMatches(opts: {
  appDir: string;
  manifestPath: string;
  log?: import('../../suite/components/logger.ts').Logger;
  testGroupName?: string;
}): Promise<'ok' | 'warn' | 'fail'>;
```

**Inputs/Outputs**  
Reads `<appDir>/.env` and manifest JSON; logs section summaries, problem boxes, and a final status line. Returns the severity and throws on FAIL.

**Dependencies**  
`fs`, `path`, `suite/components/proc.ts (logBoxCount)`, `suite/components/logger.ts`, `suite/components/scenario-status.ts`

**Behavior & details**

- Discovery: `Scaffolded .env: <N> keys discovered`
- Required: `S satisfied, M missing, C commented`
  - Boxes when non-zero: “Missing required keys” (• KEY), “Commented required keys” (• # KEY)
- Optional: `S satisfied, M missing, A active`
  - Boxes: “Missing optional keys” (• KEY), “Active optional keys” (• KEY)
- Other: `U unexpected, I ignored`
  - Box: “Unexpected keys found” with `• KEY` (active) and `• # KEY` (commented)
- Value expectations: boxed failures listed as `• KEY: message`
- Final status (last): OK if no problems, WARN if only unexpected>0, FAIL on any required missing/commented, optional missing/active, or expectation failure
- Missing `.env` / missing manifest: prints a “not found” line + a boxed “Missing file” before the final `❌`.

Annotated dump markers when debug is enabled:

- `[A]` active assignment (values masked or `(blank)`)
- `[C]` commented assignment
- `[#]` comment
- `[·]` blank/other

**Error behavior**  
Throws on FAIL only (after logging the final status). Returns `'ok' | 'warn'` otherwise.

---

## test/e2e/scenarios/\_runner/types.ts

**Status:** Implemented

**Purpose**  
Types for JSON-driven scenarios and prompt-map.

**At a glance**

| Type                 | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `ScenarioConfigFile` | Top-level config + base paths + scenarios          |
| `ScenarioEntry`      | A single scenario (`it`, `testGroupName`, `tests`) |
| `AssertScaffoldSpec` | Flags/answers/interactive spec                     |
| `PromptMap`          | Map `include` → concrete prompts                   |

**Exports**

```ts
export type ScenarioConfigFile = {
  describe?: string;
  manifestPath?: string;
  realEnvPath?: string;
  answersBasePath?: string;
  promptMapPath?: string;
  scenarios: ScenarioEntry[];
};

export type ScenarioEntry = {
  it?: string;
  testGroupName: string;
  tests: {
    assertScaffold?: AssertScaffoldSpec;
    assertEnv?: {
      manifest: string;
      expect?: Record<string, { equals?: string; pattern?: string }>;
    };
    cleanup?: boolean;
  };
};

export type AssertScaffoldSpec = {
  flags?: string[];
  answersFile?: string;
  interactive?: {
    prompts?: Array<
      | { expect: string; send: string; timeoutMs?: number; type?: 'text' }
      | {
          expect: string;
          labels: string[];
          required?: boolean;
          maxScroll?: number;
          timeoutMs?: number;
          type: 'checkbox';
        }
    >;
    include?: Array<string | { [k: string]: string }>;
  };
};

export type PromptMap = {
  text?: Array<{
    key: string;
    expect: string;
    sendIfPresent: string;
    sendIfAbsent: string;
    timeoutMs?: number;
  }>;
  checkbox?: Array<{
    key: string;
    expect: string;
    submit?: boolean;
    required?: boolean;
    maxScroll?: number;
    timeoutMs?: number;
    labelMap: Record<string, string>;
  }>;
  sequence?: Array<{
    when: string;
    steps: Array<{ type?: 'text'; expect: string; send: string; timeoutMs?: number }>;
  }>;
};
```

**Inputs/Outputs**  
Types only.

**Dependencies**  
None

**Behavior & details**  
N/A

**Error behavior**  
N/A

---

## test/e2e/scenarios/\_runner/scenario-runner.ts

**Status:** Implemented

**Purpose**  
JSON-driven executor for scenarios: **scaffold → assert (env)**. Merge step intentionally deferred.

**At a glance**

| Feature              | Notes                                                                |
| -------------------- | -------------------------------------------------------------------- |
| Resolution           | Prefers paths relative to config; has deterministic fallbacks        |
| Interactive includes | Expands via optional `prompt-map.json`; fallback heuristic otherwise |
| Logging              | Per-scenario file via `scenarioLoggerFromEnv`                        |

**Exports**

```ts
export async function runScenariosFromFile(
  configPath: string,
  opts?: { callerDir?: string },
): Promise<void>;
```

**Inputs/Outputs**  
Reads `tests.json` + prompt-map; registers Vitest tests dynamically.

**Dependencies**  
`vitest`, `fs`, `path`, `./types.ts`, `../../../components/*`, `../../../../suite/components/logger.ts`

**Behavior & details**

- Asserts **unmerged** `.env` to validate scaffolder output.
- If `mergeEnv` appears in JSON, runner **logs and skips** it (placeholder).

**Error behavior**  
Throws on missing inputs or assertion failures; logs steps in scenario log.

---

## test/e2e/schema/\_runner/types.ts

**Status:** Implemented

**Purpose**  
Types for JSON-driven schema validation.

**At a glance**

| Type               | Purpose                                                     |
| ------------------ | ----------------------------------------------------------- |
| `SchemaConfigFile` | Top-level config defining which files to validate           |
| `SchemaFileEntry`  | A single file or glob pattern with optional schema override |

**Exports**

```ts
export type SchemaFileEntry = {
  file: string; // path or glob pattern
  schema?: string; // optional per-file schema override
};

export type SchemaConfigFile = {
  defaultSchema?: string; // fallback schema when entry doesn't specify one
  files: SchemaFileEntry[];
};
```

**Inputs/Outputs**  
Types only.

**Dependencies**  
None

**Behavior & details**  
Supports glob patterns (e.g., `test/e2e/scenarios/*/config/tests.json`) to validate multiple files with a single entry.

**Error behavior**  
N/A

---

## test/e2e/schema/\_runner/schema-runner.ts

**Status:** Implemented

**Purpose**  
JSON-driven schema validator: reads `config/tests.json` or pre-release variant, expands glob patterns, validates files individually, and records results.

**At a glance**

| Feature           | Notes                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Config resolution | Prefers `pre-release-tests/<version>/config/tests.json` when `PRE_RELEASE_VERSION` is set (see `docs/pre-release-testing.md`) |
| Glob support      | Expands patterns like `scenarios/*/manifest/*.json` with fast-glob                                                            |
| Per-file override | Each entry can specify its own schema; falls back to `defaultSchema`                                                          |
| Results recording | Records each file validation as a step in `_schema-detail.json`                                                               |
| Validation engine | Uses `ajv-cli` with draft 2020-12 spec                                                                                        |

**Exports**

```ts
export async function runSchemaTestsFromFile(
  configPath: string,
): Promise<{ passed: number; failed: number }>;
```

**Inputs/Outputs**  
Reads schema config JSON; validates files using ajv-cli; writes results to `_schema-detail.json`.

**Dependencies**  
`fast-glob`, `execa`, `fs`, `path`, `suite/components/area-detail.ts` (recordSchemaStep)

**Behavior & details**

- Expands each glob pattern in config to concrete file paths
- Validates each file individually and records result with relative path
- Default config (`test/e2e/schema/config/tests.json`) validates 16 production files
- Pre-release configs test both valid and invalid fixtures for comprehensive validation
- Supports 6 schema types: prompt-map, scenario-tests, env-manifest, files-manifest, routes-manifest, answers

**Error behavior**  
Throws if config is missing or malformed. Individual file validation failures are recorded but don't stop processing.

**Notes**  
As of v0.4.3, schema tests use a config-driven approach similar to scenario tests, with support for pre-release test isolation (see [`docs/pre-release-testing.md`](./pre-release-testing.md)).

---

## test/components/env-merge.ts (Planned)

**Status:** Planned (v0.5.0)

**Purpose**  
Merge real-world credentials from `.real-env/real.env` and suite Postgres environment into the scaffolded `.env` file without clobbering user-specified values.

**At a glance**

| Feature          | Notes                                                             |
| ---------------- | ----------------------------------------------------------------- |
| Selective merge  | Don't overwrite user `PORT` unless `overwritePort: true`          |
| OAuth secrets    | Inject Google/Microsoft/etc credentials from `.real-env/real.env` |
| Suite PG env     | Inject `SUITE_PG_HOST\|PORT\|USER\|PASS` from global setup        |
| Per-scenario DB  | Set `PG_DB=e2e_scenario_<name>` for test isolation                |
| Comment preserve | Keep scaffolded structure readable where possible                 |
| Diff logging     | Optional boxed diff showing what changed                          |

**Exports (proposed)**

```ts
export type EnvMergeOptions = {
  overwritePort?: boolean; // default false - preserve scaffolded PORT
  keepComments?: boolean; // default true - preserve comment structure
  diffBox?: boolean; // default true in test logs
};

export async function mergeEnv(opts: {
  appDir: string;
  realEnvPath: string; // path to .real-env/real.env
  inject?: Record<string, string | number | boolean>; // suite PG vars + scenario DB
  mergeOpts?: EnvMergeOptions;
  log?: import('../../suite/components/logger.ts').Logger;
}): Promise<{ updated: string[]; preserved: string[]; injected: string[] }>;
```

**Inputs/Outputs**  
Reads app `.env` + `.real-env/real.env`; writes merged `.env`; returns summary of changes.

**Dependencies**  
`fs-extra`, `path`, tiny `.env` parser (local or use `dotenv`)

**Behavior & details**

- Parse both files into `{ active: Map, commented: Map }`
- Merge strategy:
  1. Preserve scaffolded structure (comments, blank lines, ordering)
  2. Update active values from `realEnv` (OAuth secrets, API keys)
  3. Inject suite PG vars unless already present and `!overwritePort`
  4. Add `PG_DB=e2e_scenario_<name>` for test isolation
- Log a boxed diff if `diffBox: true`:
  ```
  ┌─ Environment merge ─────────────────────────────
  │ Updated:  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
  │ Injected: PG_HOST, PG_PORT, PG_USER, PG_PASS, PG_DB
  │ Preserved: PORT, SESSION_SECRET (user-specified)
  └─────────────────────────────────────────────────
  ```

**Error behavior**  
Throws on missing `.env` or `.real-env/real.env`; logs warning for missing injection keys.

**Notes**  
As of v0.5.0, enables transition from "scaffolded correctly" to "can actually run tests".

---

## test/components/server-assert.ts (Planned)

**Status:** Planned (v0.5.0)

**Purpose**  
Start the scaffolded app, verify it boots successfully, probe readiness, and manage server lifecycle (start/stop/graceful shutdown).

**At a glance**

| Feature           | Notes                                              |
| ----------------- | -------------------------------------------------- |
| Start             | Spawn `npm run dev` or `node server.js`            |
| Readiness         | Wait for HTTP probe (default: `GET / → 200`)       |
| Timeout           | Configurable boot timeout (default: 30s)           |
| Port detection    | Parse actual port from logs if `PORT=0` (random)   |
| Lifecycle         | Returns `{ stop(), baseUrl }` for test usage       |
| Graceful shutdown | Test SIGTERM handling and clean shutdown           |
| Error cases       | Port conflict, crashes, timeouts, binding failures |

**Exports (proposed)**

```ts
export type ServerOptions = {
  appDir: string;
  command?: string; // default "npm run dev"
  env?: Record<string, string | undefined>;
  readiness?: {
    path?: string; // default "/"
    status?: number; // default 200
    timeoutMs?: number; // default 30000
    retries?: number; // default 10
    retryDelayMs?: number; // default 1000
  };
  log?: import('../../suite/components/logger.ts').Logger;
};

export type ServerHandle = {
  url: string; // base URL with actual port
  stop: () => Promise<void>;
  pid: number;
};

export async function startServer(opts: ServerOptions): Promise<ServerHandle>;

export async function assertGracefulShutdown(opts: {
  appDir: string;
  expectedLogPattern?: RegExp; // default /server closed/i
  maxShutdownMs?: number; // default 5000
  log?: import('../../suite/components/logger.ts').Logger;
}): Promise<void>;
```

**Inputs/Outputs**  
Spawns server process; returns handle with `stop()` and `url`; logs boxed server output.

**Dependencies**  
`execa`, `http/https`, `suite/components/proc.ts`, `suite/components/logger.ts`

**Behavior & details**

- Spawn with `openBoxedProcess` for streaming logs
- Parse port from:
  1. Explicit `PORT` env var
  2. Server startup logs (regex: `/listening.*:(\d+)/i`)
  3. Fallback to testing common ports (3000, 8080, etc.)
- Readiness probe with exponential backoff:
  - Retry on ECONNREFUSED
  - Fail on non-2xx after retries exhausted
  - Log each attempt at debug level
- `assertGracefulShutdown()`:
  1. Start server
  2. Send SIGTERM
  3. Wait for "Server closed" log (or custom pattern)
  4. Verify process exits within timeout
  5. Check no orphaned connections
- Boxed server output includes startup logs and any errors

**Error behavior**  
Throws on: port conflicts (EADDRINUSE), boot failures, timeout, non-2xx readiness responses. Logs include full server output for debugging.

**Notes**  
As of v0.5.0, server lifecycle is: start → run all HTTP/auth/session tests → assert graceful shutdown → final cleanup.

---

## test/components/http-assert.ts (Planned)

**Status:** Planned (v0.6.0)

**Purpose**  
Test public HTTP routes (non-auth) including health checks, static assets, and API endpoints. Validates status codes, headers, and response content.

**At a glance**

| Feature       | Notes                                              |
| ------------- | -------------------------------------------------- |
| Public routes | Health checks, static files, public APIs           |
| Status codes  | Single or array of acceptable codes                |
| Headers       | Exact match or regex for content-type, cache, etc. |
| Body content  | Substring match for basic validation               |
| Static assets | Favicon, CSS, JS with content-type validation      |
| Error cases   | 404, 500, connection failures                      |

**Exports (proposed)**

```ts
export type HttpRoute = {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'; // default GET
  status: number | number[]; // acceptable status codes
  headers?: Record<string, string | RegExp>; // header assertions
  contains?: string; // response body substring
  timeoutMs?: number; // default 5000
};

export type HttpAssertOptions = {
  baseUrl: string;
  routes: HttpRoute[];
  log?: import('../../suite/components/logger.ts').Logger;
};

export async function assertHttpRoutes(opts: HttpAssertOptions): Promise<void>;

// Low-level helper
export async function httpRequest(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<{
  status: number;
  headers: Record<string, string>;
  body: string;
}>;
```

**Inputs/Outputs**  
Makes HTTP requests; validates responses; logs failures with response snippets.

**Dependencies**  
`http`, `https`, `url`

**Behavior & details**

- Load routes from `manifest/routes.json` filtered by `!requiresAuth`
- For each route:
  - Make HTTP request (GET/POST/etc.)
  - Validate status code (exact or one-of array)
  - Validate headers (exact string or regex match)
  - Validate body contains substring (if specified)
- Static asset examples:
  ```json
  { "path": "/favicon.ico", "method": "GET", "status": 200,
    "headers": { "content-type": "image/x-icon" } }
  { "path": "/styles.css", "method": "GET", "status": 200,
    "headers": { "content-type": "text/css" } }
  ```
- Error status codes: Test 404 for non-existent routes, 500 for error handlers
- Compact log output:
  ```
  ✅ GET / → 200 (contains "Welcome")
  ✅ GET /api/health → 200
  ✅ GET /favicon.ico → 200 (content-type: image/x-icon)
  ❌ GET /nonexistent → 404 (expected, got 200)
  ```

**Error behavior**  
Throws on: status mismatch, header mismatch, missing substring, connection failures, timeouts. Includes response snippet (first 500 chars) in error message.

**Notes**  
As of v0.6.0, handles all public routes. Auth-protected routes tested by `auth-assert.ts`.

---

## test/components/auth-assert.ts (Planned)

**Status:** Planned (v0.6.0)

**Purpose**  
Test authentication flows across all providers (local, OAuth, bearer) including registration, login, logout, protected routes, and account management. Provider-aware with shared logic for post-auth flows.

**At a glance**

| Provider  | Auth Method                | Flows Tested                              |
| --------- | -------------------------- | ----------------------------------------- |
| local     | Form POST (email/password) | Register, login, logout, protected routes |
| google    | OAuth redirect             | Callback, login, logout, protected routes |
| microsoft | OAuth redirect             | Callback, login, logout, protected routes |
| bearer    | API key/token              | Token auth, protected routes              |

**Exports (proposed)**

```ts
export type AuthProvider = 'local' | 'google' | 'microsoft' | 'bearer';

export type AuthFlowSpec = {
  provider: AuthProvider;
  flows: {
    register?: {
      email: string;
      password: string;
      expectStatus: number; // 200 or 201
      expectErrors?: string[]; // test validation: "Email required", etc.
    };
    login?: {
      email: string;
      password: string;
      expectStatus: number; // 200 or 302
      expectCookie?: string; // session cookie name
    };
    logout?: {
      expectStatus: number; // 200 or 302
      expectRedirect?: string; // redirect path
    };
    protected?: {
      path: string;
      method?: string;
      expectStatus: number; // 200 when authed, 401/302 when not
    }[];
    accountPassword?: {
      oldPassword: string;
      newPassword: string;
      expectStatus: number;
    };
  };
};

export async function assertAuthFlows(opts: {
  baseUrl: string;
  spec: AuthFlowSpec;
  log?: import('../../suite/components/logger.ts').Logger;
}): Promise<void>;

// Provider-specific helpers
export async function assertLocalAuth(
  baseUrl: string,
  flows: AuthFlowSpec['flows'],
  log?: Logger,
): Promise<void>;

export async function assertOAuthCallback(
  baseUrl: string,
  provider: 'google' | 'microsoft',
  flows: AuthFlowSpec['flows'],
  log?: Logger,
): Promise<void>;

export async function assertBearerAuth(
  baseUrl: string,
  flows: AuthFlowSpec['flows'],
  log?: Logger,
): Promise<void>;
```

**Inputs/Outputs**  
Makes authenticated HTTP requests; validates auth flows; stores session cookies; returns success/failure per flow.

**Dependencies**  
`http/https`, `cookie` parser, `test/components/http-assert.ts` (low-level requests)

**Behavior & details**

- **Local auth flow**:
  1. POST `/auth/register` with email/password → 200/201 + session cookie
  2. POST `/auth/login` with email/password → 200/302 + session cookie
  3. GET protected route with cookie → 200
  4. POST `/auth/logout` with cookie → 200/302 + cookie cleared
  5. GET protected route without cookie → 401/302
- **OAuth flow** (simplified - may require mock provider):
  1. Simulate OAuth callback with mock token
  2. Verify session established
  3. Test protected routes with session
  4. Test logout

- **Bearer auth flow**:
  1. GET protected route with `Authorization: Bearer <token>` → 200
  2. GET protected route without header → 401
  3. GET protected route with invalid token → 401

- **Error handling** (built-in):
  - Invalid credentials → 401
  - Missing required fields → 400
  - CSRF token mismatch → 403
  - Rate limiting (if implemented) → 429
  - Account locked → 403

- Compact log output:
  ```
  ✅ local: register → 201 (session cookie set)
  ✅ local: login → 200 (session cookie set)
  ✅ local: protected route /account → 200 (authed)
  ✅ local: logout → 302 (cookie cleared)
  ❌ local: protected route /account → 401 (not authed, expected)
  ```

**Error behavior**  
Throws on: unexpected status codes, missing cookies, session not established, protected route accessible without auth. Includes request/response details in error messages.

**Notes**  
As of v0.6.0, handles all auth providers with shared post-auth logic. OAuth flows may require manual token injection or mock provider setup.

---

## test/components/session-assert.ts (Planned)

**Status:** Planned (v0.6.0)

**Purpose**  
Test session persistence across multiple HTTP requests, session expiry, and session store behavior independent of authentication flows.

**At a glance**

| Feature        | Notes                                           |
| -------------- | ----------------------------------------------- |
| Cookie storage | Verify session cookie set and stored correctly  |
| Multi-request  | Session persists across sequential requests     |
| Expiry         | Test session timeout/max-age behavior           |
| Session store  | Verify Postgres-backed sessions (if applicable) |
| Edge cases     | Invalid session ID, expired sessions, cleared   |

**Exports (proposed)**

```ts
export type SessionOptions = {
  baseUrl: string;
  loginPath?: string; // default "/auth/login"
  protectedPath?: string; // default "/account"
  credentials?: { email: string; password: string };
  sessionCookieName?: string; // default "connect.sid"
  log?: import('../../suite/components/logger.ts').Logger;
};

export async function assertSessionPersistence(opts: SessionOptions): Promise<void>;

export async function assertSessionExpiry(
  opts: SessionOptions & {
    maxAge?: number; // test session expiry after X seconds
  },
): Promise<void>;

export async function assertSessionStore(
  opts: SessionOptions & {
    pgEnv: import('../../suite/components/pg-env.ts').PgEnv;
    dbName: string;
  },
): Promise<void>;
```

**Inputs/Outputs**  
Makes sequential HTTP requests; validates session cookie behavior; queries session store if applicable.

**Dependencies**  
`http/https`, `cookie` parser, `pg` (for session store validation), `test/components/http-assert.ts`

**Behavior & details**

- **Persistence test**:
  1. Login → Get session cookie
  2. Request protected route with cookie → 200
  3. Make second request with same cookie → 200 (session still valid)
  4. Clear cookie
  5. Request protected route without cookie → 401/302

- **Expiry test**:
  1. Login → Get session cookie with `maxAge`
  2. Wait for `maxAge + 1` seconds
  3. Request protected route with expired cookie → 401/302

- **Session store test** (Postgres):
  1. Login → Get session cookie
  2. Query `sessions` table for session ID
  3. Verify session row exists with correct `user_id`
  4. Logout → Verify session row deleted or invalidated

- **Edge cases**:
  - Invalid session ID (random cookie value) → 401
  - Corrupted cookie → 400/401
  - Session store unavailable → 500 (graceful degradation)

- Compact log output:
  ```
  ✅ Session cookie set after login
  ✅ Session persists across requests (2/2 successful)
  ✅ Session expires after 60s
  ✅ Session stored in Postgres (user_id: 123)
  ✅ Session cleared after logout
  ```

**Error behavior**  
Throws on: session not persisting, cookie not cleared on logout, session store inconsistencies. Includes cookie values and session IDs in error messages (redacted in CI logs).

**Notes**  
As of v0.6.0, separate from auth-assert for clarity and testability of session behavior independent of auth flows.

---

## test/components/pg-assert.ts (Planned)

**Status:** Planned (v0.7.0)

**Purpose**  
Validate database structure (tables, columns, indexes, foreign keys, constraints) and optionally test data integrity via nested JSON manifest.

**At a glance**

| Feature      | Notes                                                  |
| ------------ | ------------------------------------------------------ |
| Tables       | Verify existence, required/optional designation        |
| Columns      | Validate names, types, nullability, defaults           |
| Indexes      | Check unique, btree, composite indexes                 |
| Foreign keys | Validate relationships and referential integrity       |
| Primary keys | Ensure PK constraints exist                            |
| Values       | Optional row count, test data existence                |
| Error cases  | Missing tables/columns, type mismatches, FK violations |

**Exports (proposed)**

```ts
export type PgColumnSpec = {
  type: string; // e.g., "integer", "varchar", "timestamp"
  nullable?: boolean; // default true
  primaryKey?: boolean;
  unique?: boolean;
  default?: string; // SQL default expression
};

export type PgIndexSpec = {
  columns: string[];
  unique?: boolean;
  type?: 'btree' | 'hash' | 'gin' | 'gist'; // default btree
};

export type PgForeignKeySpec = {
  column: string;
  references: string; // "table(column)"
  onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
  onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
};

export type PgTableSpec = {
  required: boolean;
  columns: Record<string, PgColumnSpec>;
  indexes?: Record<string, PgIndexSpec>;
  foreignKeys?: Record<string, PgForeignKeySpec>;
  values?: {
    minCount?: number; // minimum row count
    maxCount?: number; // maximum row count
    testRows?: Array<Record<string, any>>; // rows that must exist
  };
};

export type PgManifest = {
  tables: Record<string, PgTableSpec>;
};

export async function assertPgStructure(opts: {
  pgEnv: import('../../suite/components/pg-env.ts').PgEnv;
  dbName: string;
  manifest: PgManifest;
  log?: import('../../suite/components/logger.ts').Logger;
}): Promise<void>;
```

**Inputs/Outputs**  
Connects to Postgres; queries `information_schema` and `pg_catalog`; validates against manifest; logs discrepancies.

**Dependencies**  
`pg`, `suite/components/pg-env.ts`

**Behavior & details**

- Query `information_schema.tables` for table existence
- Query `information_schema.columns` for column names/types/nullability
- Query `information_schema.table_constraints` for primary keys/unique constraints
- Query `information_schema.referential_constraints` for foreign keys
- Query `pg_indexes` for index details
- For each table in manifest:
  1. Verify table exists (FAIL if required and missing)
  2. Verify all specified columns exist with correct types
  3. Verify indexes exist with correct columns and uniqueness
  4. Verify foreign keys reference correct tables/columns
  5. Optionally validate row counts and test data

- Manifest example:

  ```json
  {
    "tables": {
      "users": {
        "required": true,
        "columns": {
          "id": { "type": "integer", "primaryKey": true },
          "email": { "type": "character varying", "unique": true, "nullable": false },
          "password_hash": { "type": "character varying" },
          "created_at": { "type": "timestamp without time zone", "default": "now()" }
        },
        "indexes": {
          "users_email_key": { "columns": ["email"], "unique": true }
        },
        "values": { "minCount": 0 }
      },
      "sessions": {
        "required": true,
        "columns": {
          "sid": { "type": "character varying", "primaryKey": true },
          "sess": { "type": "json", "nullable": false },
          "expire": { "type": "timestamp without time zone", "nullable": false },
          "user_id": { "type": "integer" }
        },
        "foreignKeys": {
          "fk_user": {
            "column": "user_id",
            "references": "users(id)",
            "onDelete": "CASCADE"
          }
        }
      }
    }
  }
  ```

- Compact log output:
  ```
  ✅ Table 'users' exists (4 columns, 1 index, 0 foreign keys)
  ✅ Table 'sessions' exists (4 columns, 0 indexes, 1 foreign key)
  ✅ Column 'users.email' is unique and not null
  ✅ Foreign key 'sessions.user_id' → 'users(id)' with CASCADE
  ❌ Missing column 'users.phone' (optional)
  ❌ Index 'users_email_key' not unique (expected unique)
  ```

**Error behavior**  
Throws on: missing required tables/columns, type mismatches, missing constraints, FK violations. Includes SQL query results in error messages for debugging.

**Notes**  
As of v0.7.0, validates database structure after server tests. Future: add migration testing and schema evolution validation.
