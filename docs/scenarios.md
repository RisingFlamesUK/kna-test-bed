# Scenarios — JSON formats and runner

This doc explains the JSON configs driving scenario tests: **tests.json**, **prompt-map.json**, and the **answers.json** used by the scaffolder.

---

## Index

- [tests.json](#testsjson)
  - [Fields](#fields)
  - [Path resolution (summary)](#path-resolution-summary)
- [prompt-map.json](#prompt-mapjson)
  - [Example](#example)
  - [Validate](#validate)
- [answers.json](#answersjson)
- [Best practices](#best-practices)

---

## `tests.json`

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
- `manifestPath` (string, optional): base dir for env manifests.
- `realEnvPath`, `answersBasePath` (strings, optional): bases for resolution (future convenience).
- `scenarios` (array): list of entries.

Scenario entry:

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
      expect?: Record<string, { equals?: string; pattern?: string }>;
    };
    // Reserved (ignored by runner for now)
    mergeEnv?: { env: string };
    cleanup?: boolean;
  };
};
```

### Path resolution (summary)

- **Manifests** (e.g., `"env.json"`):
  1. `<scenario test dir>/manifest/<file>`
  2. `<scenario root>/manifest/<file>` (if config is under `<scenario>/config`)
  3. `<config dir>/manifest/<file>`
  4. `manifestPath` override (from `tests.json`)
  5. `<callerDir>`, `<configDir>`, CWD (fallbacks)

- **Answers files**: prefer `answersBasePath`, then `<callerDir>`, `<configDir>`, CWD.

Set `E2E_DEBUG_RESOLVE=1` to log candidates and the chosen path.

---

## `prompt-map.json`

Maps higher-level `include` tokens → concrete interactive prompts.

- `$schema` supported: `./prompt-map.schema.json`
- Validated in CI using `ajv` (JSON Schema 2020-12).

### Example

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
    },
    {
      "key": "axios",
      "expect": "Include\\s+Axios\\?",
      "sendIfPresent": "y\n",
      "sendIfAbsent": "n\n"
    },
    {
      "key": "passport-enable",
      "expect": "Use\\s+Passport\\.js\\s+authentication\\?",
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
        "bearer": "bearer",
        "google": "google",
        "facebook": "facebook",
        "twitter": "twitter",
        "microsoft": "microsoft",
        "linkedin": "linkedin"
```
