# kna-test-bed — Components Reference

> This document describes the components used by the test bed. It complements the high-level overview in `docs/design.md`. Each entry lists **Purpose**, **Status**, **Exports**, **Inputs/Outputs**, **Dependencies**, and **Error behavior**.

---

## Index

- Suite Components
  - [`suite/components/constants.ts`](#suitecomponentsconstantsts)
  - [`suite/components/logger.ts`](#suitecomponentsloggerts)
  - [`suite/components/proc.ts`](#suitecomponentsprocts)
  - [`suite/components/docker-suite.ts`](#suitecomponentsdocker-suitets)
  - [`suite/components/pg-env.ts`](#suitecomponentspg-envts)
  - [`suite/components/pg-suite.ts`](#suitecomponentspg-suitets)
  - [`suite/vitest-reporter.ts`](#suitevitest-reporterts)
  - [`suite/global-setup.ts`](#suiteglobal-setupts)
- Test Components
  - [`test/components/scaffold-command-assert.ts`](#testcomponentsscaffold-command-assertts)
  - [`test/components/interactive-driver.ts`](#testcomponentsinteractive-driverts)
  - [`test/components/env-assert.ts`](#testcomponentsenv-assertts)
  - Planned
    - [`test/components/server-assert.ts`](#testcomponentsserver-assertts-planned)
    - [`test/components/fs-assert.ts`](#testcomponentsfs-assertts-planned)
    - [`test/components/http-assert.ts`](#testcomponentshttp-assertts-planned)
    - [`test/components/env-update.ts`](#testcomponentsenv-updatets-planned)
    - [`test/components/pg-assert.ts`](#testcomponentspg-assertts-planned)
    - [`test/components/auth-assert.ts`](#testcomponentsauth-assertts-planned)

---

## Suite/components/constants.ts

**Status:** Implemented

**Purpose**  
Common labels/constants used by multiple components (e.g., a Docker label to tag suite-owned resources).

**At a glance**

| Key            | Value (example)                                               |
| -------------- | ------------------------------------------------------------- |
| `KNA_LABEL`    | Shared label for containers/logs (e.g. `kna-test`)            |
| `TMP_DIR_NAME` | Basename for temp workspace folder (default: `.tmp`)          |
| `KNA_TMP_DIR`  | Absolute/relative path override for temp workspace (optional) |

**Exports**

```ts
export const KNA_LABEL: string;
export const TMP_DIR_NAME: string;
export const KNA_TMP_DIR: string;
```

**Inputs/Outputs**  
N/A

**Dependencies**  
None

**Error behavior**  
N/A

---

## Suite/components/logger.ts

**Status:** Implemented

**Purpose**  
Structured logging with single-line “step/pass/fail” entries to files under `logs/<STAMP>/…`, plus **file path helpers**, **indent controls** and **boxed blocks** for subprocess output.

**At a glance**

| Capability      | Notes                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| `step`          | Left-justified `N) Title`; optional details line with indent                                                    |
| `pass` / `fail` | Emits ✅ / ❌ lines                                                                                             |
| `write`         | Free-form line; **defaults to 4-space indent**                                                                  |
| `close`         | Flush & close the file                                                                                          |
| Indent controls | Each method accepts `indent?: number \| string` (number=absolute; `"+n"`/`"-n"`=relative; other=literal prefix) |
| `withIndent`    | Returns a logger view that pre-applies a default indent to writes/pass/fail/step-details                        |
| Box helpers     | `boxStart(label)`, `boxLine(line)`, `boxEnd(footer)` draw a consistent box around grouped output                |

**Exports**

```ts
export type Logger = {
  filePath: string;
  step: (title: string, details?: string, indent?: number | string) => void;
  pass: (msg?: string, indent?: number | string) => void;
  fail: (msg: string, indent?: number | string) => void;
  write: (line: string, indent?: number | string) => void;

  // Box helpers
  boxStart: (label: string) => void;
  boxLine: (line: string) => void;
  boxEnd: (footer: string) => void;

  close: () => Promise<void>;
};

export function createLogger(filePath: string): Logger;
export function withIndent(base: Logger, indent: number | string): Logger;

export function makeLogStamp(d?: Date): string; // e.g. "2025-10-01T11-22-33-123Z"
export function sanitizeLogName(name: string): string; // safe filename
export function buildLogRoot(stamp: string): string; // logs/<stamp>
export function buildSuiteLogPath(stamp: string): string; // logs/<stamp>/suite.log
export function buildScenarioLogPath(stamp: string, scenario: string): string; // logs/<stamp>/e2e/<scenario>.log
export function scenarioLoggerFromEnv(scenario: string): Logger; // uses process.env.KNA_LOG_STAMP
```

**Inputs/Outputs**

- **Input:** target file path (for `createLogger`), or `KNA_LOG_STAMP` (for `scenarioLoggerFromEnv`)
- **Output:** step-numbered log with consistent indentation and optional boxed sections

**Dependencies**  
`fs-extra`, `path`

**Error behavior**

- `scenarioLoggerFromEnv` throws if `KNA_LOG_STAMP` is missing (global-setup should set it).

**Notes**

- All logs are **append-only** with a monotonic counter to preserve step order.
- Step headers are **left-justified**; details are indented (default 3 spaces).
- Free-form `write(...)` defaults to **4 spaces** so step “guts” line up visually.
- Box helpers render content **left-justified** inside the box; use them for subprocess output.

---

## Suite/components/proc.ts

**Status:** Implemented

---

### Purpose

Provides standardized subprocess execution helpers with consistent **logging, output boxing, and ANSI-safe streaming**.  
It unifies how the suite runs and captures CLI tools, Docker commands, and interactive processes.

---

### At a glance

| Item           | Summary                                                                               |
| -------------- | ------------------------------------------------------------------------------------- |
| Modes          | **Buffered:** `execBoxed` • **Streaming/interactive:** `openBoxedProcess`             |
| Boxed logs     | Uses the suite logger; **opens box on first output**, closes with an exit-code footer |
| ANSI stripping | Streaming path **strips ANSI** (colors/cursor controls) for readable logs             |
| Args wrapping  | Pretty JSON-style `args` list, wrapped at `argsWrapWidth` without splitting tokens    |
| Return shapes  | `execBoxed → { stdout, exitCode }` • `openBoxedProcess → { proc, closeBox }`          |
| Use cases      | Generators, Docker commands, long-running or interactive CLIs                         |

---

### Exports

```ts
// Result for buffered runs
export type SimpleExec = {
  stdout: string;
  exitCode: number;
};

// Buffered execution (boxed)
export type ExecBoxedOptions = {
  title?: string;
  argsWrapWidth?: number;
  windowsHide?: boolean;
  cwd?: string;
  env?: Record<string, string>;
};

export async function execBoxed(
  log: Logger,
  cmd: string,
  args: string[],
  opts?: ExecBoxedOptions,
): Promise<SimpleExec>;

// Streaming / interactive execution (boxed, ANSI-stripped)
export type OpenBoxedOpts = {
  title?: string;
  cwd?: string;
  env?: Record<string, string>;
  windowsHide?: boolean;
};

export type RunningProc = {
  stdin: NodeJS.WritableStream | null | undefined;
  stdout: NodeJS.ReadableStream | null | undefined;
  stderr: NodeJS.ReadableStream | null | undefined;
  wait: () => Promise<{ exitCode: number }>;
};

export function openBoxedProcess(
  log: Logger | undefined,
  cmd: string,
  args: string[],
  opts?: OpenBoxedOpts,
): { proc: RunningProc; closeBox: (exitCode: number) => void };
```

---

### Inputs/Outputs

**Inputs** — `cmd: string`, `args: string[]`, logger, options (title, wrapping width, cwd, env, windowsHide)  
**Outputs** — `execBoxed → Promise<SimpleExec>` • `openBoxedProcess → { proc, closeBox }` (use `await proc.wait()` → `{ exitCode }`)

---

### Dependencies

- `execa` (spawning)
- `suite/components/logger.ts` (boxed logging)

---

### Behavior & details

- Boxes open lazily (first output) to avoid empty frames
- Streaming lines are flushed as they arrive; progress repaint noise is minimized
- Consistent formatting across Docker, scaffolds, and generator runs

---

### Error behavior

- Non-zero exits preserved (returned via `{ exitCode }`)
- Exceptions only if callers rethrow
- Streaming path strips ANSI before logging
- Always writes boxed footer: `exit code: N`

---

## Suite/components/docker-suite.ts

**Status:** Implemented

**Purpose**  
Docker lifecycle helpers: availability checks, image pulls, run/wait, and bulk cleanup by label. Subprocesses are logged using `proc.ts` with **boxed** `docker` output.

**At a glance**

| Category  | Items                                                             |
| --------- | ----------------------------------------------------------------- |
| Lifecycle | `ensureDocker`, `runContainer`, `waitForHealthy`, `removeByLabel` |
| Utilities | `waitForTcp`, `pullImage`                                         |
| Types     | `PublishSpec`, `RunContainerOptions`                              |

**Exports**

```ts
export async function ensureDocker(log?: Logger): Promise<void>;
export async function pullImage(image: string, log?: Logger): Promise<void>;

export type PublishSpec = {
  containerPort: number;
  host?: string;
  hostPort?: number;
};

export type RunContainerOptions = {
  image: string;
  name?: string;
  env?: Record<string, string>;
  labels?: Record<string, string>;
  publish?: PublishSpec[];
  detach?: boolean;
  removeOnStop?: boolean;
  preArgs?: string[]; // docker run <preArgs> image ...
  args?: string[]; // docker run image <args>
};

export async function runContainer(
  opts: RunContainerOptions,
  log?: Logger,
): Promise<{
  name: string;
  stop: () => Promise<void>;
  remove: () => Promise<void>;
}>;

export async function waitForTcp(
  host: string,
  port: number,
  timeoutMs?: number,
  log?: Logger,
): Promise<void>;

export async function waitForHealthy(
  containerName: string,
  timeoutMs?: number,
  log?: Logger,
): Promise<void>;

export async function removeByLabel(label: string, log?: Logger): Promise<void>;
```

**Inputs/Outputs**

- **Input:** Docker image name, labels, env, and publish specs.
- **Output:** Running container and convenience lifecycle helpers; **boxed** `docker` output for clarity.

**Dependencies**  
`execa`, Node `net`, `crypto`; `suite/components/proc.ts`; optional `Logger` for structured logs

**Error behavior**

- Docker missing/daemon down → throws with a clear remediation hint.
- Health/TCP timeouts → throws with host/port and elapsed timeout.
- If the image lacks a Docker **HEALTHCHECK**, `waitForHealthy` may time out; prefer `waitForTcp` in that case.

**Notes**

- No general `inspect`/port-discovery helpers are exported; tests should pass explicit publish mappings.

---

## Suite/components/pg-env.ts

**Status:** Implemented

**Purpose**  
Define the canonical Postgres env shape and read the **suite-provided** connection info from `process.env` (set by `global-setup` as `SUITE_PG_*`). This module is dependency-free and safe to import from any test component.

**At a glance**

| Aspect | Items / Meaning                                                                            |
| ------ | ------------------------------------------------------------------------------------------ |
| Inputs | `SUITE_PG_HOST`, `SUITE_PG_PORT`, `SUITE_PG_USER`, `SUITE_PG_PASS` (set by `global-setup`) |
| Output | `PgEnv` object (`PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASS`)                                |
| Scope  | **Cluster-only** (no DB name) — tests add `PG_DB` per scenario as needed                   |
| Safety | Dependency-free; safe to import from any test component                                    |

**Exports**

```ts
export type PgEnv = {
  PG_HOST: string; // e.g., 127.0.0.1
  PG_PORT: number; // mapped host port for container 5432
  PG_USER: string; // typically "postgres"
  PG_PASS: string; // password set for the container
};

export function getSuitePgEnv(): PgEnv; // reads SUITE_PG_HOST/PORT/USER/PASS
```

**Inputs / Outputs**

- **Input:** `process.env.SUITE_PG_HOST|PORT|USER|PASS` (written by `global-setup`)
- **Output:** a strongly-typed `PgEnv` object for cluster-level access (no database name)

**Naming note (app .env)**  
The **scaffolded app** expects `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASS`, and **`PG_DB`** in its `.env`. The test bed writes **`PG_DB` per scenario** when it creates the per-test database. We intentionally keep `PgEnv` **database-agnostic** here (cluster only).

**Dependencies**  
None

**Error behavior**  
If `SUITE_PG_*` are missing, downstream code may fail. `global-setup` must run first to set these variables.

---

## Suite/components/pg-suite.ts

**Status:** Implemented

**Purpose**

Manage a single Postgres container for the suite and provide helpers for per-test isolation via **schemas** (fast) or **databases** (strong isolation). This module performs IO (Docker, TCP, SQL) and **imports** the type + env reader from `pg-env.ts`.

**Exports**

```ts
export type PgHandle = {
  env: PgEnv; // from pg-env.ts
  containerName: string; // docker name/id
  stop(): Promise<void>; // stop/remove container
};

export async function ensurePg(log?: Logger, opts?: { clean?: boolean }): Promise<PgHandle>;

export async function withTempSchema<T>(
  prefix: string,
  run: (ctx: {
    schema: string;
    connect: () => Promise<Client>;
    searchPathSql: string;
  }) => Promise<T>,
  log?: Logger,
): Promise<T>;

export async function createDb(name: string, log?: Logger): Promise<void>;
export async function dropDb(name: string, log?: Logger): Promise<void>;
```

**Internal (not exported)**

- `ensureSharedDb(...)` — prepares one shared DB used by `withTempSchema`
- `probePg(...)` — light `SELECT 1` probe during PG bring-up

**Models & when to use**

- **Per-schema** (`withTempSchema`) — fastest; use when your **test controls the connection** and can `SET search_path`.
- **Per-database** (`createDb`/`dropDb`) — safest for **black-box E2E** where the **app** opens its own pool; you’ll write the DB name to the app’s `.env` as `PG_DB`.

**Inputs / Outputs**

- **Input:** Docker Desktop available; suite label from `constants.ts`
- **Output:** one running PG container for the run; ephemeral schemas or databases per test

**Dependencies**  
`pg`, `suite/components/docker-suite.ts`, `suite/components/proc.ts`, `suite/components/logger.ts`, `suite/components/constants.ts`, `suite/components/pg-env.ts`

**Error behavior**

- Docker/health/TCP timeouts throw with context
- DB create/drop errors throw with SQL detail
- `ensurePg` is idempotent and race-safe

---

## Suite/vitest-reporter.ts

**Status:** Implemented

**Purpose**

Custom Vitest reporter that writes a **per-file, per-test summary** into the suite log (`logs/<stamp>/suite.log`), grouped beneath the **“Run Tests”** step. It routes all output through `logger.ts`, buffers until `KNA_LOG_STAMP` is available, and renders clear status icons. Scenario log links are **correctly matched** per test and never cross-linked between files (file-level fallback).

**At a glance**

| Aspect         | Behavior                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Grouping       | Per **test file** header with counts (tests, passed, failed, skipped)                                                   |
| Lines          | One line per test with **✅ pass / ❌ fail / ↩️ skip** and rounded duration (ms)                                        |
| Indentation    | Entire block indented under “Run Tests”; file headers and bullets vertically aligned                                    |
| Buffering      | Lines buffered until `KNA_LOG_STAMP` exists, then flushed via the suite logger                                          |
| Log linking    | `[SCENARIO_LOG] <path>` in test output is attached to the **right** test line; per-file fallback prevents cross-linking |
| Failure safety | Never throws; logging failures are swallowed so tests aren’t affected                                                   |

**Exports**

```ts
// Default class (instantiated in vitest.config.ts)
export default class SuiteReporter {
  /* ... */
}
```

**Inputs/Outputs**

- **Inputs:** Vitest runner events; `process.env.KNA_LOG_STAMP` (set by `global-setup`)
- **Outputs:** Lines appended to `logs/<stamp>/suite.log` under the “Run Tests” step

**Configuration (`vitest.config.ts`)**

```ts
import { defineConfig } from 'vitest/config';
import SuiteReporter from './suite/vitest-reporter.ts';

export default defineConfig({
  test: {
    reporters: [
      ['default', { summary: false }], // Vitest v3 default without the summary footer
      new SuiteReporter(), // our custom suite log reporter
    ],
    // ...rest of your config
  },
});
```

**Recommended setup**  
Add a clear anchor step in `global-setup.ts` before tests run, and yield once at teardown start so reporter hooks flush _before_ step 6:

```ts
// suite/global-setup.ts
// after publishing SUITE_PG_*:
suiteLog.step('Run Tests');

// at the very start of the returned teardown():
await new Promise<void>((resolve) => setImmediate(resolve));
// then:
suiteLog.step('Global teardown: stop Postgres');
```

**Optional: attach per-test scenario log links**  
From helpers (e.g., `assertScaffoldCommand`) so the reporter can append a log link to each test line:

```ts
const log = scenarioLoggerFromEnv(scenarioName);
console.log('[SCENARIO_LOG]', log.filePath); // reporter converts to file:// URL in suite.log
```

**Dependencies**

- `suite/components/logger.ts` (uses `createLogger`, `buildSuiteLogPath`)

**Error behavior**

- Never throws; on any logging issue, lines are buffered or dropped without affecting test execution.

---

## Suite/global-setup.ts

**Status:** Implemented

**Purpose**  
Vitest `globalSetup` for suite lifecycle:

1. checks Docker, cleans stale containers by label
2. ensures Postgres image
3. starts PG and probes readiness
4. stamps logs + writes suite log
5. exports `SUITE_PG_*` (+ `KNA_LOG_STAMP`)
6. tears down PG at the end.

**At a glance**

| Phase    | Actions                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| Setup    | `Docker: check availability` → stale cleanup → `Docker: ensure Postgres image` → `Postgres: start container` |
| Runtime  | `Suite: publish Postgres env` → `Run Tests` (reporter writes under this step)                                |
| Teardown | Stop PG container → close logger → print `logs/<stamp>` pointer                                              |

**Exports**

```ts
// default export compatible with vitest.config.ts globalSetup
export default async function globalSetup(): Promise<void | (() => Promise<void>)>;
```

**Behavior**

- Create a run stamp via `makeLogStamp()` and set:
  - `KNA_LOG_STAMP` (used by logger helpers)
  - `KNA_LABEL` (shared label for suite-created resources)
- Open `logs/<stamp>/suite.log` with `createLogger(...)`.
- `ensurePg(suiteLog, { clean: true })` to start a single Postgres container for the run.
- Publish **suite PG env** for test components:
  - `SUITE_PG_CONTAINER`
  - `SUITE_PG_HOST`, `SUITE_PG_PORT`, `SUITE_PG_USER`, `SUITE_PG_PASS`
- Return a teardown function that:
  - Stops the PG container (best effort)
  - Closes the suite logger
  - Prints a clickable pointer to the logs root

**Inputs/Outputs**

- **Inputs:** Host with Docker Desktop
- **Outputs:**
  - `logs/<stamp>/suite.log`
  - `KNA_LOG_STAMP`, `KNA_LABEL`
  - `SUITE_PG_CONTAINER`, `SUITE_PG_HOST|PORT|USER|PASS`

**Dependencies**  
`logger.ts`, `docker-suite.ts`, `pg-suite.ts`, `constants.ts`

**Error behavior**  
Any startup failure logs `fail(...)` and rethrows with a clear pointer to `suite.log`.

---

## Test/components/scaffold-command-assert.ts

**Status:** Implemented

**Purpose**  
Run the Kickstart CLI to scaffold into a temp dir and **assert** that the command completes successfully (exit code, transcript). This does **not** start the server or validate `.env` content — those are covered by other test components.

**At a glance**

| Aspect           | Behavior                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Temp location    | Uses `KNA_TMP_DIR` (if set) or `<repo>/.tmp/`                                                                  |
| App folder name  | `<timestamp>-<sanitized-scenario>` (e.g., `2025-10-02T00-41-12Z-local-only-silent`)                            |
| Generator modes  | `linked` (default, e.g. `kickstart-node-app`), `npx` (`@latest` or version), or `node` (local entry)           |
| Answers vs flags | If `answersFile` is provided, **flags are ignored** (non-interactive)                                          |
| Logging          | `cmd=` + **wrapped** `args=[…]` + **boxed** generator output via `proc.ts`; also emits `[SCENARIO_LOG] <path>` |
| Cleanup          | Removes the generated app by default; keep when `keepArtifacts: true`                                          |

**Exports**

```ts
export type ScaffoldCmdOpts = {
  scenarioName: string; // e.g. "local-only"
  flags: string[]; // raw CLI flags (ignored when answersFile is provided)
  answersFile?: string; // path to answers JSON
  keepArtifacts?: boolean; // default false
  subcommand?: string; // default "web"
  generator?:
    | { kind: 'linked'; spec: string } // default: { kind: "linked", spec: "kickstart-node-app" }
    | { kind: 'node'; entry: string } // local dev path, e.g. "./packages/cli/bin/cli.js"
    | { kind: 'npx'; spec: string }; // e.g. "kickstart-node-app@latest" or "@1.2.3"
};

export type ScaffoldResult = {
  appDir: string; // absolute path to the generated app
  logPath: string; // logs/<stamp>/e2e/<scenario>.log
  cleanup: () => Promise<void>;
};

export async function assertScaffoldCommand(opts: ScaffoldCmdOpts): Promise<ScaffoldResult>;
```

**Behavior (happy path)**

1. Ensure temp root exists.
2. Pick unique `appDir`; **abort** if it already exists.
3. Build the command:
   - `linked`: `kickstart-node-app <subcommand> <appDir> [flags…]`
   - `npx`: `npx <spec> <subcommand> <appDir> [flags…]`
   - `node`: `node <entry> <subcommand> <appDir> [flags…]`
4. Mode:
   - **answers file** → add `--answers-file <path>`; ignore flags; non-interactive
   - **silent** (`--silent` flag present) → non-interactive
   - **otherwise** → interactive (`stdio: "inherit"`)
5. Stream child output into scenario log; on success, mark `pass`, else `fail` and throw.
6. Best-effort cleanup (unless `keepArtifacts`).

**Inputs/Outputs**

- **Input:** `opts` as above
- **Output:** `ScaffoldResult` with `appDir`, `logPath`, and `cleanup` function

**Dependencies**

- `fs-extra`, `execa`
- `suite/components/logger.ts` (`scenarioLoggerFromEnv`, naming utilities)
- `suite/components/constants.ts` (temp dir)

**Error behavior**

- Existing `appDir` → throws with path context
- Non-zero exit or spawn error → logs transcript and rethrows
- Cleanup errors are logged but do not rethrow

---

## Test/components/interactive-driver.ts

**Status:** Implemented

---

### Purpose

Automates **interactive CLI prompts** in end-to-end tests.  
Matches stdout with regex and sends keyboard responses, including **checkbox navigation with scrolling**, while streaming output into suite logs.

---

### At a glance

| Item                | Summary                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| Prompt types        | **Text:** regex → `send` • **Checkbox:** label-based selection with arrow/space/enter |
| Resilience          | Ignores ANSI, tolerates **ordering changes**, supports long lists with scrolling      |
| Timeouts            | Per-prompt timeouts (defaults: 15s text, 20s checkbox)                                |
| Required selections | `required: true` throws if a requested label isn’t found within the scan              |
| Logging             | Shares the same **boxed** output as processes (via `openBoxedProcess`)                |

---

### Exports

```ts
// Text prompt
export type TextPrompt = {
  type?: 'text';
  expect: RegExp;
  send: string; // include '\n' if needed
  timeoutMs?: number; // default 15_000
};

// Checkbox prompt (Inquirer-style)
export type CheckboxPrompt = {
  type: 'checkbox';
  expect: RegExp; // identifies the checkbox section
  select: string[]; // labels to toggle (case-insensitive)
  submit?: boolean; // default true → press Enter after selections
  required?: boolean; // throw if any label not found after bounded scan
  maxScroll?: number; // cap down-arrow steps (default 2000)
  timeoutMs?: number; // default 20_000
};

export type Prompt = TextPrompt | CheckboxPrompt;

export async function runInteractive(opts: {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  prompts: Prompt[];
  logger?: Logger;
  logTitle?: string;
  windowsHide?: boolean;
}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOutAt?: number; // index of the prompt that timed out
}>;
```

---

### Inputs/Outputs

**Inputs** — `cmd`, `args?`, `cwd?`, `env?`, `prompts: Prompt[]`, optional `logger`/`logTitle`  
**Outputs** — `{ stdout, stderr, exitCode, timedOutAt? }`

---

### Dependencies

- `suite/components/proc.ts` (uses `openBoxedProcess`)
- `suite/components/logger.ts`

---

### Behavior & details

- **ANSI-aware parsing** (colors/cursor codes removed before matching)
- **Checkbox scanning** scrolls through long lists, toggles only if not already selected, then submits
- Designed to produce realistic, stable automation across generators and scaffolds

---

### Error behavior

- Times out per prompt; exposes `timedOutAt` on failure
- With `required: true`, errors when a requested checkbox label isn’t found within `maxScroll`
- Fails cleanly if the subprocess exits before prompts complete

---

## Test/components/env-assert.ts

**Status:** Implemented

**Purpose**  
Validate that the scaffolded `.env` matches a manifest: **required** keys must be present and **uncommented**; **optional** keys, when present, should be **commented**.

**Exports**

```ts
export type EnvManifest = {
  required?: string[];
  optional?: string[];
};

export async function assertEnvMatches({
  appDir,
  manifestPath,
  envFile = '.env',
  log,
  scenarioName,
}: {
  appDir: string;
  manifestPath: string;
  envFile?: string;
  log?: Logger;
  scenarioName?: string;
}): Promise<void>;
```

**Behavior**

- Parses `.env` lines into **active** (`FOO=bar`) vs **commented** (`# FOO=bar`) keys
- Computes **exact differences** vs the manifest (not just counts)
- Fails with a clear list of **Missing required**, **Required commented**, **Missing optional**, and **Optional active**
- Logs step + details using `logger.ts` (so it integrates with scenario logs and numbering)

**Inputs/Outputs**

- **Inputs:** `appDir`, manifest path, optional logger or `scenarioName` to open the scenario log
- **Outputs:** Log lines and **fail/throw** on mismatch; ✅ pass when all rules satisfied

**Dependencies**  
`fs-extra`, `path`, `suite/components/logger.ts` (optional)

**Error behavior**  
Throws if the `.env` or manifest file is missing; otherwise throws with detailed mismatch reasons.

---

## Test/components/fs-assert.ts (Planned)

**Status:** Planned

**Purpose**  
Verify presence/absence of files per scenario manifest.

**Proposed exports**

```ts
export async function assertFiles(
  appDir: string,
  manifest: { required: string[]; forbidden?: string[] },
): Promise<void>;
```

---

## Test/components/http-assert.ts (Planned)

**Status:** Planned

**Purpose**  
Check HTTP routes’ status codes, headers, and small content matches.

**Proposed exports**

```ts
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

---

## Test/components/env-update.ts (Planned)

**Status:** Planned

**Purpose**  
Merge `.real-env/real.env` with dynamic per-test PG values into the app’s `.env` without clobbering OAuth or explicit `PORT` unless requested.

**Proposed exports**

```ts
export async function writeMergedEnv(
  appDir: string,
  realEnvPath: string,
  extra: Record<string, string | number | boolean>,
  opts?: { overwritePort?: boolean },
): Promise<string>; // returns path to written .env
```

---

## Test/components/pg-assert.ts (Planned)

**Status:** Planned

**Purpose**  
Smoke-check app can connect to the per-test database and (optionally) session tables exist.

**Proposed exports**

```ts
export async function assertPgConnects(pgEnv: PgEnv, dbName: string): Promise<void>;
export async function assertSessionTables(pgEnv: PgEnv, dbName: string): Promise<void>; // optional
```

---

## Test/components/auth-assert.ts (Planned)

**Status:** Planned

**Purpose**  
Exercise the **local** auth happy path (signup → login → protected route). OAuth scenarios will use provider stubs.

**Proposed exports**

```ts
export async function assertLocalAuthFlow(
  baseUrl: string,
  opts?: { signupPath?: string; loginPath?: string; protectedPath?: string },
): Promise<void>;
```

---
