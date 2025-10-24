// suite/global-setup.ts
import path from 'node:path';
import fs from 'fs-extra';
import { pathToFileURL } from 'node:url';

import {
  createLogger,
  buildSuiteLogPath,
  buildLogRoot,
  makeLogStamp,
} from './components/logger.ts';
import { ensureDocker } from './components/docker-suite.ts';
import { ensurePg, PgHandle } from './components/pg-suite.ts';
import type { ScenarioSeverity } from './components/scenario-status.ts';

const ICON: Record<ScenarioSeverity, string> = { ok: '✅', warn: '⚠️', fail: '❌' };

function toSev(x: unknown): ScenarioSeverity {
  return x === 'ok' || x === 'warn' || x === 'fail' ? x : 'fail';
}

// Helper to always print a pointer to this run’s logs
function printLogsPointer(stamp: string) {
  const root = buildLogRoot(stamp);
  const abs = path.resolve(root);
  const url = pathToFileURL(abs).toString();
  // Console output: keeps working even if logging failed early
  console.log(`\n📝 Logs for this run: ${abs}`);
  console.log(`   ${url}\n`);
}

export default async function globalSetup(): Promise<void | (() => Promise<void>)> {
  // 1) Stamp + open suite log *before* doing anything that can fail
  const stamp = makeLogStamp();
  process.env.KNA_LOG_STAMP = stamp;

  const suiteLogPath = buildSuiteLogPath(stamp);
  const suiteLog = createLogger(suiteLogPath);

  let pg: PgHandle | null = null;

  try {
    // 2) Pre-clean: if previous run left anything behind, remove it now
    suiteLog.step('Docker: check availability');
    await ensureDocker(suiteLog);

    // 3) Start Postgres (ensurePg logs its own sub-steps & boxes)
    pg = await ensurePg(suiteLog, { clean: true });

    // 4) Publish suite PG env so test components can read via pg-env.ts
    suiteLog.step('Suite: publish Postgres env');
    process.env.SUITE_PG_CONTAINER = pg.containerName;
    process.env.SUITE_PG_HOST = String(pg.env.PG_HOST);
    process.env.SUITE_PG_PORT = String(pg.env.PG_PORT);
    process.env.SUITE_PG_USER = String(pg.env.PG_USER);
    process.env.SUITE_PG_PASS = String(pg.env.PG_PASS);
    suiteLog.write(`container=${pg.containerName}`);
    suiteLog.pass('SUITE_PG_* exported');

    // 5) Anchor for the reporter — everything it prints will indent under this step
    suiteLog.step('Run Tests');

    // 6) Return teardown that stops PG and closes the log (and prints pointer)
    return async () => {
      // Let reporter flush one tick before we start teardown steps
      await new Promise<void>((r) => setImmediate(r));

      // --- Consolidated Step 7: Suite/Schema/Scenario summaries (before teardown) ---
      try {
        const root = buildLogRoot(stamp);
        const e2eDir = path.join(root, 'e2e');
        const vitestSummaryPath = path.join(e2eDir, '_vitest-summary.json');
        const scenDetailPath = path.join(e2eDir, '_scenario-detail.json');

        const MARK: Record<string, string> = { pass: '✅', fail: '❌', skip: '↩️', unknown: '❓' };

        // Read artifacts (both optional)
        const vitest = (await fs.pathExists(vitestSummaryPath))
          ? ((await fs.readJson(vitestSummaryPath)) as {
              files: {
                path: string;
                counts: { total: number; passed: number; failed: number; skipped: number };
                tests: { name: string; state: string; duration?: number }[];
              }[];
              totals: { total: number; passed: number; failed: number; skipped: number };
            })
          : { files: [], totals: { total: 0, passed: 0, failed: 0, skipped: 0 } };

        const scenDetail: Record<string, any> = (await fs.pathExists(scenDetailPath))
          ? await fs.readJson(scenDetailPath)
          : {};

        // Helpers
        const findFiles = (re: RegExp) => vitest.files.filter((f) => re.test(f.path));
        const printFileGroup = (title: string, files: typeof vitest.files) => {
          if (!files.length) return;
          suiteLog.write(
            `  ┌─ ${title} ─────────────────────────────────────────────────────────────`,
          );
          for (const f of files) {
            suiteLog.write(`  │ ${f.path}`);
            for (const t of f.tests) {
              const dur = t.duration != null ? ` (${t.duration}ms)` : '';
              suiteLog.write(`  │ • ${MARK[t.state] ?? '❓'} ${t.name}${dur}`);
            }
            const c = f.counts;
            suiteLog.write(
              `  └─ (tests: ${c.total}, passed: ${c.passed}, failed: ${c.failed}, warning: 0, skipped: ${c.skipped}) ────────────────`,
            );
          }
        };

        // 1) Suite tests
        printFileGroup('Suite tests', findFiles(/test[\\/]+e2e[\\/]+suite\.test\.ts$/i));

        // 2) Scenario schema tests
        printFileGroup(
          'Scenario schema tests',
          findFiles(
            /test[\\/]+e2e[\\/]+scenarios[\\/]+_runner[\\/]+prompt-map\.schema\.test\.ts$/i,
          ),
        );

        // 3) Scenario tests from our artifacts (includes WARN)
        if (Object.keys(scenDetail).length) {
          suiteLog.write(
            `  ┌─ Scenario tests ──────────────────────────────────────────────────────────`,
          );

          const names = Object.keys(scenDetail).sort((a, b) => a.localeCompare(b));
          let okCount = 0,
            warnCount = 0,
            failCount = 0;

          for (const name of names) {
            const d = scenDetail[name] || {};
            // Compute worst-of across steps
            const sevList = ['scaffold', 'env', 'files']
              .map((k) => d[k]?.severity)
              .filter(Boolean) as Array<'ok' | 'warn' | 'fail'>;
            const rank = { ok: 0, warn: 1, fail: 2 } as const;
            const worst = sevList.reduce<'ok' | 'warn' | 'fail'>(
              (acc, s) => (rank[acc] >= rank[s] ? acc : s),
              'ok',
            );

            if (worst === 'fail') failCount++;
            else if (worst === 'warn') warnCount++;
            else okCount++;

            suiteLog.write(`  │ • ${ICON[toSev(worst)]} ${name} — ${worst.toUpperCase()}`);

            const steps: Array<['scaffold' | 'env' | 'files', any]> = [
              ['scaffold', d.scaffold],
              ['env', d.env],
              ['files', d.files],
            ];
            for (const [step, info] of steps) {
              if (!info) continue;
              const meta = info.meta ?? {};
              const counts = ['missingCount', 'breachCount', 'unexpectedCount']
                .map((k) => (meta[k] != null ? `${k.replace('Count', '')}: ${meta[k]}` : null))
                .filter(Boolean)
                .join(', ');
              const note = meta.note ? (counts ? `; ${meta.note}` : meta.note) : '';
              const extra = counts || note ? `  (${[counts, note].filter(Boolean).join(' ')})` : '';
              suiteLog.write(
                `  │     - ${ICON[toSev(info.severity)]} ${step}: ${info.severity.toUpperCase()}${extra}`,
              );
            }

            const absLog = path
              .resolve(e2eDir, `${name}.log`)
              .replace(/\\/g, '/')
              .replace(/ /g, '%20');
            suiteLog.write(`  │     - log: file:///${absLog}`);
          }

          suiteLog.write(
            `  └─ (tests: ${names.length}, passed: ${okCount}, failed: ${failCount}, warning: ${warnCount}, skipped: 0)  ────────────────`,
          );
        } else {
          suiteLog.write(`  (no _scenario-detail.json found)`);
        }
      } catch (e: any) {
        suiteLog.write(`  (failed to render consolidated Step 7: ${e?.message ?? String(e)})`);
      }

      suiteLog.step('Global teardown: stop Postgres');
      try {
        if (pg) await pg.stop();
        suiteLog.pass('Postgres container stopped');
      } catch (e: any) {
        suiteLog.fail(`Failed to stop Postgres container (continuing): ${e?.message ?? e}`);
      } finally {
        await suiteLog.close();
        printLogsPointer(stamp);
      }
    };
  } catch (err: any) {
    // ❶ Log once to suite.log, then close it
    const msg = err?.message ?? String(err);
    suiteLog.fail(`Global setup failed: ${msg}`);
    await suiteLog.close();

    // ❷ Expose a hint for tests (e.g. suite sentinel) to surface a *cause* not just the symptom
    process.env.KNA_SETUP_ERROR = msg;

    // ❸ Still return a teardown so the pointer prints at the *bottom* of the CLI output
    return async () => {
      printLogsPointer(stamp);
    };
  }
}
