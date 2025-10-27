# Scenarios — JSON formats and runner

This doc explains the JSON configs driving scenario tests: **tests.json**, **prompt-map.json**, the **answers.json** used by the scaffolder, and the **files.json** used by file assertions.

---

## Index

- [tests.json](#testsjson)
  - [Example (tests.json)](#example-testsjson)
  - [Fields](#fields)
  - [Path resolution (summary)](#path-resolution-summary)
- [prompt-map.json](#prompt-mapjson)
  - [Example (prompt-map.json)](#example-prompt-mapjson)
  - [Validate](#validate)
- [answers.json](#answersjson)
  - [Reference](#reference)
- [files.json (filesystem manifest)](#filesjson-filesystem-manifest)
  - [Example (files.json)](#example-filesjson)
  - [Patterns & matching guide](#patterns--matching-guide)
  - [Semantics](#semantics)
  - [Outcome](#outcome)
  - [Path resolution](#path-resolution)
- [env.json (environment manifest)](#envjson-environment-manifest)
  - [Example (env.json)](#example-envjson)
  - [Semantics](#semantics-1)
  - [Outcome](#outcome-1)
  - [Path resolution](#path-resolution-1)
- [Artifacts & logs](#artifacts--logs)
- [Best practices](#best-practices)
  - [Example (best practices)](#example-best-practices)

---

## `tests.json`

### Example (tests.json)

The per-scenario test list. Example:

```json
{
  "describe": "local-only scaffold",
  "promptMapPath": "test/e2e/schema/fixtures/prompt-map-valid.json",
  "manifestPath": "test/e2e/scenarios/local-only/manifest/",
  "realEnvPath": "test/e2e/scenarios/local-only/.real-env/",
  "scenarios": [
    {
      "it": "silent mode: scaffolds app without errors",
      "scenarioName": "local-only-silent",
      "tests": {
        "assertScaffold": { "flags": ["--silent", "--passport", "local"] },
        "assertEnv": { "manifest": "env.json" },
        "assertFiles": { "manifest": "files.json" },
        "mergeEnv": { "env": ".real.env" },
        "cleanup": true
      }
    },
    {
      "it": "answers-file mode: scaffolds app without error",
      "scenarioName": "local-only-answers",
      "tests": {
        "assertScaffold": {
          "flags": [],
          "answersFile": "test/e2e/scenarios/local-only/config/answers.json"
        },
        "assertEnv": { "manifest": "env.json" },
        "assertFiles": { "manifest": "files.json" },
        "mergeEnv": { "env": ".real.env" },
        "cleanup": true
      }
    },
    {
      "it": "interactive mode: scaffolds app without errors (prompts)",
      "scenarioName": "local-only-interactive",
      "tests": {
        "assertScaffold": {
          "flags": [],
          "interactive": {
            "include": ["postgres", "session", { "passport": "local" }]
          }
        },
        "assertEnv": { "manifest": "env.json" },
        "assertFiles": { "manifest": "files.json" },
        "mergeEnv": { "env": ".real.env" },
        "cleanup": true
      }
    }
  ]
}
```

### Fields

- `describe` (string): suite title.
- `promptMapPath` (string, optional): path to `prompt-map.json` (see below).
- `manifestPath` (string, optional): base dir for manifests (e.g., `env.json`, `files.json`).
- `realEnvPath`, `answersBasePath` (strings, optional): bases for resolution.
- `scenarios` (array): list of entries.

Scenario entry shape:

```ts
type ScenarioEntry = {
  it?: string;
  scenarioName: string;
  tests: {
    assertScaffold?: {
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
        include?: Array<string | Record<string, string>>;
      };
    };

    // Runs on UNMERGED .env
    assertEnv?: {
      manifest: string;
      // optional expectations on active keys: equals/pattern
      expect?: Record<string, { equals?: string; pattern?: string }>;
    };

    // Required/forbidden/ignore files manifest
    assertFiles?: { manifest: string };

    // Reserved (ignored by runner for now)
    mergeEnv?: { env: string };

    cleanup?: boolean;
  };
};
```

### Path resolution (summary)

- **Manifests** (e.g., `"env.json"`, `"files.json"`):
  1. `<scenario test dir>/manifest/<file>`
  2. `<scenario root>/manifest/<file>` (if `tests.json` is under `<scenario>/config`)
  3. `<config dir>/manifest/<file>`
  4. `manifestPath` override (from `tests.json`)
  5. `<callerDir>`, `<configDir>`, CWD (fallbacks)

- **Answers files**: prefer `answersBasePath`, then `<callerDir>`, `<configDir>`, CWD.

Set `E2E_DEBUG_RESOLVE=1` to log candidates and the chosen path.

---

## `prompt-map.json`

Maps higher-level `include` tokens → concrete interactive prompts.

- `$schema` supported: `./prompt-map.schema.json`
- Validated in CI (AJV, JSON Schema 2020-12).

### Example (prompt-map.json)

```json
{
  "$schema": "./prompt-map.schema.json",
  "text": [
    {
      "key": "postgres",
      "expect": "Include\\s+PostgreSQL\\?",
      "sendIfPresent": "y\n",
      "sendIfAbsent": "n\n"
    },
    {
      "key": "session",
      "expect": "Enable\\s+session\\s+management\\?",
      "sendIfPresent": "y\n",
      "sendIfAbsent": "n\n"
    }
  ],
  "checkbox": [
    {
      "key": "passport",
      "expect": "Select\\s+Passport\\s+strategies",
      "labelMap": {
        "local": "local",
        "google": "google"
      },
      "required": true,
      "maxScroll": 200
    }
  ],
  "sequence": [
    {
      "when": "Use\\s+Passport\\.js\\s+authentication\\?",
      "steps": [{ "type": "text", "expect": "Use\\s+Passport.*\\?", "send": "y\n" }]
    }
  ]
}
```

### Validate

- Schema: `test/e2e/schema/config/prompt-map.schema.json`
- Test: `test/e2e/schema/schema-validation.test.ts`
- Run: `npx vitest` (schema validation runs as part of the test suite)

---

## `answers.json`

### Reference

The answers file format is **owned by the scaffolder**. For the most accurate and up-to-date schema and examples, refer to the **Kickstart Node App** README in the scaffolder repository for the version you are testing.

- Tests reference the file via `tests.assertScaffold.answersFile` in `tests.json`.
- Path resolution in the runner prefers `answersBasePath` (when provided), then falls back to `<callerDir>`, `<configDir>`, and `CWD` (see [Path resolution (summary)](#path-resolution-summary)).
- Keep answers **deterministic and minimal** to reduce flaky diffs.

## files.json (filesystem manifest)

### Example (files.json)

```json
{
  "required": [".env", "README.md", "public/**"],
  "forbidden": ["secrets.*", "tmp/**"],
  "ignore": ["node_modules/**", ".git/**"]
}
```

### Patterns & matching guide

**Engine & flags**  
Matching uses `picomatch` with `{ dot: true, nocase: true }`.

- **Case-insensitive**: patterns match ignoring case.
- **Dotfiles included**: names starting with `.` are considered.
- **POSIX paths in manifests**: use forward slashes (`/`). The runner normalizes at runtime.

**Common globs**

| Pattern          | Matches                                        |
| ---------------- | ---------------------------------------------- | ----------------------------------------- |
| `*.js`           | Any `.js` file in the current tree level       |
| `**/*.js`        | Any `.js` file in any subdirectory (recursive) |
| `public/**`      | Everything under `public/` (files and folders) |
| `views/*.ejs`    | `.ejs` files directly under `views/`           |
| `views/**/*.ejs` | `.ejs` files anywhere under `views/`           |
| `README.*`       | `README.md`, `README.txt`, etc.                |
| `config/@(db     | pg).js`                                        | Extglob: `config/db.js` or `config/pg.js` |
| `!(tmp)/**`      | Extglob: everything except under `tmp/`        |

> Extglobs like `@(a|b)` and `!(x)` are supported by picomatch.

**Force exact matches**

- For an **exact file**, avoid glob characters:
  - Exact: `README.md`, `routes/auth.js`
  - Not exact: `README.*`, `routes/*.js`
- For an **entire directory**, include `/**`:
  - Entire tree: `public/**`
  - One level only: `public/*`

**Path tips**

- Always write manifest paths using **forward slashes** (e.g., `views/index.ejs`) irrespective of OS.
- Don’t rely on case sensitivity (especially on Windows/macOS default filesystems).

### Semantics

**Sets & rules**

- `required`: **each pattern must match ≥ 1 file** under the scaffolded app.
- `forbidden`: if **any** file matches a pattern, it’s a **breach**.
- `ignore`: matched files are removed from consideration (but still counted in the overall “discovered”).

**Derived sets**

- `present` = union of files matched by all `required` patterns
- `missing` = required patterns that matched **zero** files
- `breach` = files matching any `forbidden` pattern
- `unexpected` = considered files minus `(present ∪ breach)`

> Where **considered** = all discovered files **minus** ignored files.

### Outcome

- **FAIL**: `missing > 0` or `breach > 0` (throws in the test)
- **WARN**: `unexpected > 0` (no throw; logged as warning)
- **OK**: otherwise

### Path resolution

Same resolution order as other manifests:

1. `<callerDir>/manifest`
2. `<scenarioRootFromConfig>/manifest` (when `tests.json` lives under `<scenario>/config`)
3. `<configDir>/manifest`
4. `manifestPath` (if provided at the top level)
5. `<callerDir>`
6. `<configDir>`
7. `CWD`

> Set `E2E_DEBUG_RESOLVE=1` to log candidate paths and the chosen one.

---

## env.json (environment manifest)

The env manifest drives assertions on the unmerged `.env` file emitted by the scaffolder.

### Example (env.json)

```json
{
  "required": ["SESSION_SECRET", "PG_HOST", "PG_USER", "PG_PASS"],
  "optional": ["PG_PORT", "PG_DB"],
  "ignoreUnexpected": ["PORT", "NODE_ENV"],
  "expect": {
    "NODE_ENV": { "equals": "development" },
    "PG_HOST": { "pattern": "^(localhost|127\\.0\\.0\\.1)$" }
  }
}
```

### Semantics

Assertions run against the unmerged `.env` (exact scaffolder output) and distinguish between:

- Active assignments: `KEY=VALUE` (uncommented)
- Commented assignments: `# KEY=VALUE`

Rules:

- `required`: keys must be present and active (uncommented). Commented required keys are treated as problems.
- `optional`: keys must be present but commented. If an optional key is active, it’s a problem. If it’s missing, it’s also a problem.
- `ignoreUnexpected`: keys listed here are removed from the “unexpected” calculation only. They do not override `required`/`optional` rules.
- `expect`: value checks on active keys only. Supports `equals` and `pattern` (regex string). Any failure is a problem.

Summaries and boxes:

- Discovery summary: `Scaffolded .env: <N> keys discovered`
- Section summaries:
  - Required: `<S> satisfied, <M> missing, <C> commented`
  - Optional: `<S> satisfied, <M> missing, <A> active`
  - Other: `<U> unexpected, <I> ignored`
- Problem-only boxes (only when counts > 0):
  - Missing required keys
  - Commented required keys
  - Missing optional keys
  - Active optional keys
  - Unexpected keys found (lists both active and commented unexpected keys; commented are prefixed with `# `)
  - Value expectation failures (when any)

Missing inputs:

- If `.env` is missing: prints a clear line (`.env file not found: <path>`) and a boxed “Missing file” section before the final status.
- If `env.json` is missing: prints `Manifest file not found: <path>` and a boxed “Missing file” section before the final status.

### Outcome

- FAIL: any required missing or commented; any optional missing or active; any expectation failure; missing `.env` or manifest.
- WARN: only unexpected keys remain after `ignoreUnexpected` filter (no FAIL-level issues).
- OK: none of the above.

The final line is printed last and standardized:

- `✅ env-assert: OK`
- `⚠️ env-assert: WARN`
- `❌ env-assert: FAIL`

The scenario runner records the env severity and continues to the files step even on env FAIL (to surface more signal in one pass).

### Path resolution

Same resolution order as other manifests (see [Path resolution](#path-resolution)):

1. `<callerDir>/manifest`
2. `<scenarioRootFromConfig>/manifest` (when `tests.json` lives under `<scenario>/config`)
3. `<configDir>/manifest`
4. `manifestPath` (if provided at the top level)
5. `<callerDir>`
6. `<configDir>`
7. `CWD`

Set `E2E_DEBUG_RESOLVE=1` to log candidate paths and the chosen one.

---

## Best practices

- Keep `required` bounded and stable; use globs carefully (prefer concrete paths for high-signal checks).
- Always ignore volatile trees like `node_modules/**`, `.git/**`.
- Reserve `forbidden` for **must-not-ship** artefacts; keep it small and explicit.
- Prefer `prompt-map.json` + `interactive.include` over embedding concrete prompts in `tests.json`.

**Pre-release testing**: See [`docs/pre-release-testing.md`](./pre-release-testing.md) for detailed guide on using version-specific test assets. Quick summary:

- Place version-specific test assets under `pre-release-tests/<version>/` (gitignored)
- Set `PRE_RELEASE_VERSION=<version>` or use `npm run test:pre -- <version>`
- Runner auto-picks versioned config when present, falls back to production config otherwise

---

## Artifacts & logs

During a run the suite emits both human-readable logs and JSON artifacts:

- `logs/<STAMP>/suite.log` — top-level suite log (Docker/PG) with group bullets and summaries in stable order: Suite → Schema → Scenarios.
- `logs/<STAMP>/e2e/_suite-detail.json` — append-only step lines for the Suite area (authoritative source for the reporter).
- `logs/<STAMP>/e2e/_schema-detail.json` — append-only step lines for Schema/meta tests.
- `logs/<STAMP>/e2e/_scenario-detail.json` — step-level severities per scenario (fixed three steps: `scaffold`, `env`, `files`).
- `logs/<STAMP>/e2e/_vitest-summary.json` — Vitest per-file counts/durations (always written by the reporter).
- Per-scenario logs: `logs/<STAMP>/e2e/<scenario>.log`. CI prints absolute `file:///` URLs for quick navigation.

Reporter extras in CI:

- Scenario area header prints two absolute links: the scenario test file and the active `tests.json` (pre-release variant preferred when set).
- Each test prints a `• Testing <scenario>...` bullet, step lines for `scaffold`, `env manifest checks`, `files manifest checks`, and an immediate log link.
- The consolidated suite summary also includes per-step reasons for WARN/FAIL (e.g., “required keys commented”, “optional keys active”, “env/files manifest not found”).

---

### Example (best practices)

```json
{
  "describe": "local-only scaffold",
  "manifestPath": "test/e2e/scenarios/local-only/manifest/",
  "scenarios": [
    {
      "it": "silent mode: scaffolds app without errors",
      "scenarioName": "local-only-silent",
      "tests": {
        "assertScaffold": { "flags": ["--silent", "--passport", "local"] },
        "assertEnv": { "manifest": "env.json" },
        "assertFiles": { "manifest": "files.json" },
        "cleanup": true
      }
    }
  ]
}
```
