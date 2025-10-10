# kna-test-bed — Components Reference

> This document is derived from the **actual code** and intended architecture in this repo.  
> Each entry lists **Status**, **Purpose**, **At a glance**, **Exports**, **Inputs/Outputs**, **Dependencies**, **Behavior & details**, **Error behavior**, and **Notes** (if useful).

---

## Index

- Suite Components
  - [`suite/components/constants.ts`](#suitecomponentsconstantsts)
  - [`suite/components/logger.ts`](#suitecomponentsloggerts)
  - [`suite/components/proc.ts`](#suitecomponentsprocts)
  - [`suite/components/docker-suite.ts`](#suitecomponentsdocker-suitets)
  - [`suite/components/pg-env.ts`](#suitecomponentspg-envts)
  - [`suite/components/pg-suite.ts`](#suitecomponentspg-suitets)
  - [`suite/components/scenario-status.ts`](#suitecomponentsscenario-statusts)
  - [`suite/vitest-reporter.ts`](#suitevitest-reporterts)
  - [`suite/global-setup.ts`](#suiteglobal-setupts)

- Test Components
  - [`test/components/scaffold-command-assert.ts`](#testcomponentsscaffold-command-assertts)
  - [`test/components/interactive-driver.ts`](#testcomponentsinteractive-driverts)
  - [`test/components/env-assert.ts`](#testcomponentsenv-assertts)

- Scenario Runner
  - [`test/e2e/scenarios/_runner/types.ts`](#teste2escenarios_runnertypests)
  - [`test/e2e/scenarios/_runner/scenario-runner.ts`](#teste2escenarios_runnerscenario-runnerts)

- Planned Components
  - [`test/components/server-assert.ts`](#testcomponentsserver-assertts-planned)
  - [`test/components/fs-assert.ts`](#testcomponentsfs-assertts)
  - [`test/components/http-assert.ts`](#testcomponentshttp-assertts-planned)
  - [`test/components/env-update.ts`](#testcomponentsenv-updatets-planned)
  - [`test/components/pg-assert.ts`](#testcomponentspg-assertts-planned)
  - [`test/components/auth-assert.ts`](#testcomponentsauth-assertts-planned)

---

## suite/components/constants.ts

**Status:** Implemented

**Purpose**  
Shared constants for labels and temp directory paths.

**At a glance**

| Name           | Meaning                                   |
| -------------- | ----------------------------------------- |
| `KNA_LABEL`    | Docker label used to tag suite resources  |
| `TMP_DIR_NAME` | Basename for temp workspace (`.tmp`)      |
| `KNA_TMP_DIR`  | Optional override for temp root (env var) |

**Exports**

```ts
export const KNA_LABEL: string;
export const TMP_DIR_NAME: string;
export const KNA_TMP_DIR: string;
```

**Inputs/Outputs**  
Reads optional env vars; no IO.

**Dependencies**  
None

**Behavior & details**  
Used by Docker helpers and scaffold helpers for consistent naming/paths.

**Error behavior**  
N/A

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

## suite/vitest-reporter.ts

**Status:** Implemented

**Purpose**  
Optional per-file/per-test text output and a machine-readable JSON summary used by the suite.log's consolidated Step 7.

**At a glance**

| Behavior             | Notes                                                                 |
| -------------------- | --------------------------------------------------------------------- |
| **Quiet by default** | No per-file text unless enabled (see _Controls_).                     |
| Controls             | Enable text with `--verbose` or `-v`, or `KNA_VITEST_TEXT=1`.         |
| JSON artifact        | Always writes `logs/<STAMP>/e2e/_vitest-summary.json`.                |
| No double-reporting  | We do **not** use Vitest’s default reporter. Only this reporter runs. |
| Robust               | Never throws; JSON write is best-effort.                              |

**Exports**

```ts
export default class SuiteReporter {
  /* Vitest v3 reporter */
}
```

**Inputs/Outputs**  
Consumes runner events; writes to `suite.log`.

**Dependencies**  
`path`, `url`, `suite/components/logger.ts`

**Behavior & details**  
Formats durations, aligns bullets, avoids cross-linking logs.

**Error behavior**  
Never throws; drops lines on hard failures.

---

## suite/global-setup.ts

**Status:** Implemented

**Purpose**  
Vitest global setup: prepare Docker + Postgres, stamp logs, publish env, and return teardown.

**At a glance**

| Phase    | Actions                                                              |
| -------- | -------------------------------------------------------------------- | ---- | ---- | ----- |
| Setup    | Docker check → stale cleanup → ensure image → run container → probes |
| Publish  | `KNA_LOG_STAMP`, `SUITE_PG_HOST                                      | PORT | USER | PASS` |
| Teardown | Stop container, close log, print logs pointer                        |

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
  scenarioName: string;
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
Exposes `timedOutAt`; callers decide whether to throw. Checkbox can throw if `required`.

---

## test/components/env-assert.ts

**Status:** Implemented

**Purpose**  
Validate the **unmerged** `.env` against a manifest:

- `required` keys must be **active** (uncommented).
- `optional` keys must be present but **commented**.
- Optional `expect` map allows **value checks** (`equals` / `pattern`) on **active** keys.

**At a glance**

| Feature           | Notes                                                     |
| ----------------- | --------------------------------------------------------- |
| Parse & diff      | Distinguishes active vs commented assignments             |
| Value checks      | `expect: { KEY: { equals?/pattern? } }`                   |
| Boxed diagnostics | Annotated `.env` dump with legend via `logBox` on failure |

**Exports**

```ts
export async function assertEnvMatches(opts: {
  appDir: string;
  manifestPath: string;
  log?: import('../../suite/components/logger.ts').Logger;
}): Promise<void>;
```

**Inputs/Outputs**  
Reads `<appDir>/.env` and manifest JSON; logs pass/fail.

**Dependencies**  
`fs`, `path`, `suite/components/proc.ts (logBox)`, `suite/components/logger.ts`

**Behavior & details**  
Annotated dump markers:

- `[A]` active assignment (values masked or `(blank)`)
- `[C]` commented assignment
- `[#]` comment
- `[·]` blank/other

**Error behavior**  
Throws on missing files or mismatches (after detailed logging).

---

## test/e2e/scenarios/\_runner/types.ts

**Status:** Implemented

**Purpose**  
Types for JSON-driven scenarios and prompt-map.

**At a glance**

| Type                 | Purpose                                           |
| -------------------- | ------------------------------------------------- |
| `ScenarioConfigFile` | Top-level config + base paths + scenarios         |
| `ScenarioEntry`      | A single scenario (`it`, `scenarioName`, `tests`) |
| `AssertScaffoldSpec` | Flags/answers/interactive spec                    |
| `PromptMap`          | Map `include` → concrete prompts                  |

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
  scenarioName: string;
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

## test/components/server-assert.ts (Planned)

**Status:** Planned

**Purpose**  
Start the scaffolded app and probe core routes (startup health + basic endpoints).

**At a glance**

| Feature    | Notes                                   |
| ---------- | --------------------------------------- |
| Start/stop | Spawn `npm run dev` or `node server.js` |
| Readiness  | Wait for HTTP 200 on `/` (configurable) |
| Probes     | GET routes with simple content checks   |

**Exports (proposed)**

```ts
export type ServerAssertOptions = {
  appDir: string;
  baseUrl?: string; // if known, else parse from dev log or .env PORT
  waitFor?: { path: string; status?: number; timeoutMs?: number }; // default { "/", 200, 30000 }
  env?: Record<string, string | undefined>;
  log?: import('../../suite/components/logger.ts').Logger;
};

export async function startServer(
  opts: ServerAssertOptions,
): Promise<{ stop: () => Promise<void>; url: string }>;

export async function assertRoutes(
  baseUrl: string,
  routes: Array<{
    path: string;
    expectStatus: number | number[];
    contains?: string;
    headers?: Record<string, string | RegExp>;
  }>,
): Promise<void>;
```

**Inputs/Outputs**  
Spawns a server process; probes routes; returns a `stop()`.

**Dependencies**  
`execa`, `http/https`, `suite/components/proc.ts`, `suite/components/logger.ts`

**Behavior & details**  
Parses port from `.env` or dev server logs; retries during boot.

**Error behavior**  
Timeouts and non-2xx codes throw with clear diagnostics.

---

## test/components/fs-assert.ts

**Status:** Implemented

**Purpose**  
Assert filesystem layout of the scaffolded app using a per-scenario manifest.

**At a glance**

| Feature    | Notes                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------- |
| Required   | `required` patterns — **each pattern must match ≥ 1 file** (case-insensitive)                |
| Forbidden  | `forbidden` patterns — any match is a **breach**                                             |
| Ignore     | `ignore` patterns — removed from consideration (but still counted in the total “discovered”) |
| Unexpected | Files that are neither required nor forbidden (post-ignore)                                  |
| Severity   | **FAIL** on any `missing` or `breach` • **WARN** on `unexpected>0` • **OK** otherwise        |
| Boxes      | Uses `proc.logBoxCount()` to print compact lists with bottom labels                          |
| Debug      | Set `E2E_DEBUG_FS_ASSERT=1` to add a capped “context” box                                    |

**Exports**

```ts
export async function assertFiles(opts: {
  cwd: string; // sandbox root
  manifest: import('../../suite/types/fs-assert.ts').AssertFilesManifestV1;
  logger: import('../../suite/types/logger.ts').Logger;
  manifestLabel?: string; // shown in the header for clarity
  scenarioName?: string; // updates per-scenario status sentinel
}): Promise<void>;
```

**Inputs/Outputs**  
Reads the sandbox under `cwd`. Logs:

- Header: step title + aligned `cwd=` and `manifest=`.
- Summaries:
  - `Scaffolded output: <N> files discovered`
  - `- Required Files Test (<R> required): <S> satisfied, <M> missing`
  - `- Forbidden Files Test (<F> forbidden): Outcome: <B> breach`
  - `- Other Files Found: <U> unexpected, <I> ignored`
- Boxes (only when non-zero): **Missing files** / **Forbidden files found** / **Unexpected files found**.

**Dependencies**  
`fs`, `path`, `picomatch`, `suite/components/proc.ts` (`logBoxCount`), `suite/types/logger.ts`

**Behavior & details**

- `discovered = all files under cwd (including ignored)`.
- `considered = discovered − ignored`.
- `presentFiles = ∪ matches of required patterns over considered (case-insensitive)`.
- `missing = count(required patterns with 0 matches)`.
- `breach = ∪ matches of forbidden patterns over considered`.
- `unexpected = considered − (presentFiles ∪ breach)`.
- Final line **last**: `❌ FAIL` (throws), `⚠️ WARN`, or `✅ OK`.

**Error behavior**  
Throws on **FAIL** (any missing or breach). **WARN** does not throw.

**Notes**

- The runner calls this **after** `.env` assertion and **before** any future merge step.
- Per-scenario status is recorded internally for later suite summaries.

---

## test/components/http-assert.ts (Planned)

**Status:** Planned

**Purpose**  
Lightweight HTTP assertions for status, content, and headers.

**At a glance**

| Feature    | Notes                   |
| ---------- | ----------------------- |
| Status     | Single or one-of values |
| Body match | `contains` substring    |
| Headers    | Exact or regex          |

**Exports (proposed)**

```ts
export async function httpGet(
  url: string,
  opts?: { headers?: Record<string, string>; timeoutMs?: number },
): Promise<{ status: number; headers: Record<string, string>; body: string }>;

export async function assertHttp(
  baseUrl: string,
  specs: Array<{
    path: string;
    expectStatus: number | number[];
    contains?: string;
    headers?: Record<string, string | RegExp>;
  }>,
  log?: import('../../suite/components/logger.ts').Logger,
): Promise<void>;
```

**Inputs/Outputs**  
Performs HTTP GETs and asserts responses; logs compact diffs.

**Dependencies**  
`http`, `https`, `url`

**Behavior & details**  
Retries with backoff (configurable) for flaky starts.

**Error behavior**  
Throws with response snippet to aid debugging.

---

## test/components/env-update.ts (Planned)

**Status:** Planned

**Purpose**  
Merge scenario `./.real-env/real.env` into the app’s `.env` **after** assertion, plus dynamic DB/env injection (e.g., suite PG vars), without clobbering user-sensitive keys unless requested.

**At a glance**

| Merge policy      | Notes                                          |
| ----------------- | ---------------------------------------------- |
| Preserve defaults | Don’t clobber explicit `PORT` unless asked     |
| Inject PG         | Apply `SUITE_PG_*` + `PG_DB` for the scenario  |
| Idempotent        | Safe re-run; comments preserved where possible |

**Exports (proposed)**

```ts
export type EnvMergeOptions = {
  overwritePort?: boolean;
  keepComments?: boolean;
};

export async function writeMergedEnv(
  appDir: string,
  realEnvPath: string,
  inject: Record<string, string | number | boolean>,
  opts?: EnvMergeOptions,
): Promise<string>; // returns path written
```

**Inputs/Outputs**  
Reads app `.env` + `.real-env/real.env`; writes updated `.env`.

**Dependencies**  
`fs-extra`, `path`, tiny `.env` parser (local)

**Behavior & details**  
Stable ordering of keys; comments retained when feasible.

**Error behavior**  
Throws on missing inputs or write failures; logs a boxed diff.

---

## test/components/pg-assert.ts (Planned)

**Status:** Planned

**Purpose**  
Smoke-check DB connectivity and (optionally) presence of session tables.

**At a glance**

| Check          | Notes                         |
| -------------- | ----------------------------- |
| Connectivity   | Connect and `SELECT 1`        |
| Session tables | Optional existence assertions |

**Exports (proposed)**

```ts
export async function assertPgConnects(
  pg: import('../../suite/components/pg-env.ts').PgEnv,
  dbName: string,
): Promise<void>;
export async function assertSessionTables(
  pg: import('../../suite/components/pg-env.ts').PgEnv,
  dbName: string,
): Promise<void>;
```

**Inputs/Outputs**  
Connects with `pg`; throws on failures.

**Dependencies**  
`pg`

**Behavior & details**  
Respects per-test search path or DB name based on scenario design.

**Error behavior**  
Throws with SQL error details.

---

## test/components/auth-assert.ts (Planned)

**Status:** Planned

**Purpose**  
Exercise **local** auth happy path: signup → login → protected route.

**At a glance**

| Step   | Notes                                |
| ------ | ------------------------------------ |
| Signup | POST form / JSON (configurable)      |
| Login  | Establish session/cookie             |
| Access | Confirm protected route is reachable |

**Exports (proposed)**

```ts
export type AuthFlowOptions = {
  signupPath?: string;
  loginPath?: string;
  protectedPath?: string;
  bodyKind?: 'form' | 'json';
};

export async function assertLocalAuthFlow(baseUrl: string, opts?: AuthFlowOptions): Promise<void>;
```

**Inputs/Outputs**
