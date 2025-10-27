// test/e2e/suite/suite.test.ts
import { describe, it, expect } from 'vitest';

import { scenarioLoggerFromEnv } from '../../../suite/components/logger.ts';
import * as path from 'node:path';
import { createCI } from '../../../suite/components/ci.ts';
import { recordSuiteStep } from '../../../suite/components/area-detail.ts';
import { withTempSchema } from '../../../suite/components/pg-suite.ts';
import {
  ENV_LOG_STAMP,
  LOGS_DIR,
  E2E_DIR,
  SUITE_LOG_FILE,
} from '../../../suite/components/constants.ts';
// Emit steps via CI console for streaming; reporter will capture icon lines

describe('Database Environment Setup', () => {
  it('should connect to Postgres and handle per-test schemas', async () => {
    const log = scenarioLoggerFromEnv('suite-sentinel');
    const ci = createCI();
    // reporter computes and prints durations; we don't need timing here

    // Step 1: quick preflight so we fail clearly when PG isn’t available
    log.step('Opening per-test schema via withTempSchema');

    const missingEnv: string[] = [];
    if (!process.env.SUITE_PG_HOST) missingEnv.push('SUITE_PG_HOST');
    if (!process.env.SUITE_PG_PORT) missingEnv.push('SUITE_PG_PORT');
    if (!process.env.SUITE_PG_USER) missingEnv.push('SUITE_PG_USER');
    if (process.env.SUITE_PG_PASS == null) missingEnv.push('SUITE_PG_PASS');

    if (missingEnv.length) {
      const setupErr = process.env.KNA_SETUP_ERROR;
      const message = setupErr
        ? `Global setup error: ${setupErr}`
        : `Missing SUITE_PG_*: ${missingEnv.join(', ')}`;

      log.fail(message);
      log.write(`See suite.log for details.`);
      recordSuiteStep('fail', message);
      await log.close();
      throw new Error(message);
    }

    try {
      await withTempSchema(
        'e2e',
        async ({ connect, schema, searchPathSql }) => {
          log.pass(`Shared DB ready: ${schema}`);
          // Record step for reporter JSON-backed streaming
          recordSuiteStep('ok', `Shared DB ready: ${schema}`);

          log.step('Running SELECT 1');
          const c = await connect();
          const r = await c.query('SELECT 1 AS one');
          expect(r.rows[0].one).toBe(1);
          log.pass('SELECT 1 succeeded');
          recordSuiteStep('ok', 'SELECT 1 succeeded');

          log.step('Testing schema round-trip');
          await c.query(
            `${searchPathSql}; CREATE TABLE demo_t(x int); INSERT INTO demo_t(x) VALUES(10),(20);`,
          );
          const got = await c.query('SELECT COUNT(*)::int AS n FROM demo_t;');
          expect(got.rows[0].n).toBe(2);
          recordSuiteStep('ok', 'Schema round-trip (create/insert/select): OK');

          // Explicit log link for reporter to pick up (absolute file URL)
          const absSentinel = path
            .resolve(LOGS_DIR, String(process.env[ENV_LOG_STAMP] || ''), E2E_DIR, SUITE_LOG_FILE)
            .replace(/\\/g, '/')
            .replace(/ /g, '%20');
          ci.write(`log: file:///${absSentinel}`);

          log.pass('Schema round-trip (create/insert/select) succeeded');

          await c.end();
        },
        log, // keep continuous numbering/indent in the same logger
      );
    } catch (err: any) {
      // Make sure sentinel logs capture the real error
      log.fail(`Suite sentinel failed: ${err?.message ?? err}`);
      log.boxStart('error');
      log.boxLine(String(err?.stack ?? err));
      log.boxEnd('end error');
      recordSuiteStep('fail', `Suite test failed: ${err?.message ?? err}`);
      await log.close();
      throw err; // still fail the test (keeps CLI signal)
    } finally {
      // If happy path, we want clean close, too
      if ((log as any)?.close) await log.close();
    }
  });
});
