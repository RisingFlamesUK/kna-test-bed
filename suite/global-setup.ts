// suite/global-setup.ts
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createLogger,
  buildSuiteLogPath,
  buildLogRoot,
  makeLogStamp,
} from './components/logger.ts';
import { ensureDocker } from './components/docker-suite.ts';
import { ensurePg, PgHandle } from './components/pg-suite.ts';

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
