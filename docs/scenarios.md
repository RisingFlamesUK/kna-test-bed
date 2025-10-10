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
  "promptMapPath": "test/e2e/scenarios/_runner/prompt-map.json",
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

- Schema: `test/e2e/scenarios/_runner/prompt-map.schema.json`
- Test: `test/e2e/scenarios/_runner/prompt-map.schema.test.ts`
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

## Best practices

- Keep `required` bounded and stable; use globs carefully (prefer concrete paths for high-signal checks).
- Always ignore volatile trees like `node_modules/**`, `.git/**`.
- Reserve `forbidden` for **must-not-ship** artefacts; keep it small and explicit.
- Prefer `prompt-map.json` + `interactive.include` over embedding concrete prompts in `tests.json`.

---

## Artifacts & logs

During a run the suite emits both human-readable logs and JSON artifacts:

- `logs/<STAMP>/suite.log` — top-level suite log (Docker/PG) plus consolidated **Step 7** with Suite/Schema/Scenario summaries.
- `logs/<STAMP>/e2e/_scenario-detail.json` — step-level severities per scenario (single source of truth).
- `logs/<STAMP>/e2e/_vitest-summary.json` — Vitest per-file counts/durations (written by the custom reporter).
- Per-scenario logs: `logs/<STAMP>/e2e/<scenario>.log`. Step 7 links these as `./e2e/<scenario>.log` (relative). CI may also print an absolute `file://` URL.

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
