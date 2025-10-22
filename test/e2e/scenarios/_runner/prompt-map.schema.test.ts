// test/meta/prompt-map.schema.test.ts
import { execa } from 'execa';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { scenarioLoggerFromEnv } from '../../../../suite/components/logger.ts';
import { createCI } from '../../../../suite/components/ci.ts';
import { recordSchemaStep } from '../../../../suite/components/area-detail.ts';

describe('prompt-map schema validation', () => {
  it('validated all prompt-map.json files against the schema', async () => {
  const log = scenarioLoggerFromEnv('prompt-map.schema');
  const ci = createCI();
    const t0 = Date.now();

    const schema = path.resolve(process.cwd(), 'test/e2e/scenarios/_runner/prompt-map.schema.json');
    const pattern = path.resolve(process.cwd(), 'test/e2e/**/prompt-map.json');

    try {
      log.step('Validating prompt-map.json files with ajv-cli');

      // Reporter injects the standardized bullet; no need to emit here

      const { stdout } = await execa(
        'npx',
        ['ajv', 'validate', '--spec', 'draft2020', '-s', schema, '-d', pattern, '--strict=false'],
        { stdout: 'pipe', stderr: 'pipe' },
      );

  if (stdout) log.write(stdout);
  log.pass('All prompt-map.json files are valid.');
  // Record step in JSON for reporter to stream
  recordSchemaStep('ok', 'All prompt-map.json files are valid');
    } catch (e: any) {
      const out = e?.stdout ?? '';
      const err = e?.stderr ?? e?.message ?? String(e);
      if (out) log.write(out);
      log.fail(String(err));
  recordSchemaStep('fail', `Schema validation failed: ${err}`);
      throw e;
    } finally {
    // Explicit log line
    const dt = Date.now() - t0;
  ci.write('log: file://./e2e/prompt-map.schema.log');
      
      if ((log as any)?.close) await (log as any).close?.();
    }
  }, 30_000);
});
