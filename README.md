# kna-test-bed

End-to-end testbed for the **Kickstart Node App** scaffolder.  
It spins up Postgres in Docker (once per run), scaffolds example apps, and asserts the generated outputs (e.g. `.env` contents).

---

## Why this exists

- **Reproducible E2E**: exercise the CLI exactly as a user would (flags, answers file, interactive).
- **Tight logging**: each run writes structured logs under `logs/<STAMP>/…` with numbered steps.
- **Safe**: the test harness is self-cleaning (temp app dirs, containers).

---

## Prerequisites

- **Node.js** ≥ 18 and npm
- **Docker** (CLI + daemon)
  - If Docker isn’t running, the suite logs will show a friendly error and tests that need PG will be skipped/fail clearly.

---

## Quick start

```bash
npm install
npm run test
```

You’ll see a clickable log root printed in the terminal, e.g.

```
📝 Logs for this run: logs/2025-10-03T12-34-56-789Z
```

- Per-scenario logs live at `logs/<STAMP>/e2e/*.log`.
- The suite log (Docker/PG lifecycle + test summaries) is `logs/<STAMP>/suite.log`.

---

## What gets tested (initial focus)

- **Scaffold: local-only**
  - Flags mode: `--silent --passport local`
  - Answers-file mode: `{"passport":"local","port":4001}`
- **.env assert**
  - Confirms every key listed in the manifest exists in the generated `.env`
  - `required` keys are **active** (not commented)
  - `optional` keys are **commented**

> OAuth client details are not injected by flags or answers file right now—tests that need them write to `.env` after scaffolding.

---

## Logs you’ll see

- `suite.log`  
  Docker/PG availability, image checks, container run, health/port checks, published env, and a per-file test summary.
- `e2e/<scenario>.log`  
  Precise CLI invocation, boxed generator output, and per-step assertions (e.g., `.env` validation).

Boxed blocks look like:

```
┌─ generator output ─────────────────────────────────────────
│ …scaffolder logs here…
└─ exit code: 0 ─────────────────────────────────────────────
```

---

## Conventions (short)

- Step headers are **left-justified**: `N) Title`
- Details are indented under the step
- We visually separate our logs from subprocess output with **boxed** sections
- Logs are **append-only** per run and numbered for continuity across components

---

## Troubleshooting

- **Docker not running**  
  `suite.log` will show:  
  `❌ Docker CLI not found or daemon not running. Start Docker Desktop/daemon and try again.`

- **PG env missing in tests**  
  `suite.sentinel.log` will explain which `SUITE_PG_*` keys were missing and point you to `suite.log` for the root cause.

---

## License

MIT
