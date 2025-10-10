// test/meta/prompt-map.schema.test.ts
import { execa } from 'execa';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { scenarioLoggerFromEnv } from '../../../../suite/components/logger.ts';
import { CIEmitter } from '../../../../suite/components/ci-emitter.ts';

describe('prompt-map schema validation', () => {
  it('validated all prompt-map.json files against the schema', async () => {
    const log = scenarioLoggerFromEnv('prompt-map.schema');
    const ci = new CIEmitter();

    const schema = path.resolve(process.cwd(), 'test/e2e/scenarios/_runner/prompt-map.schema.json');
    const pattern = path.resolve(process.cwd(), 'test/e2e/**/prompt-map.json');

    try {
      log.step('Validating prompt-map.json files with ajv-cli');
      ci.schemaStep('Validating prompt-map.json files...');
      ci.schemaStep('Checking all scenario prompt-map.json files');

      const { stdout } = await execa(
        'npx',
        ['ajv', 'validate', '--spec', 'draft2020', '-s', schema, '-d', pattern, '--strict=false'],
        { stdout: 'pipe', stderr: 'pipe' },
      );

      if (stdout) log.write(stdout);
      log.pass('All prompt-map.json files are valid.');
      ci.schemaStep('All prompt-map.json files are valid');
      ci.schemaEnd(
        'prompt-map.schema.test.ts • Schema test > validated all prompt-map.json files',
        'e2e/prompt-map.schema.log',
        { failed: 0, skipped: 0 },
      );

      expect(true).toBe(true);
    } catch (e: any) {
      const out = e?.stdout ?? '';
      const err = e?.stderr ?? e?.message ?? String(e);
      if (out) log.write(out);
      log.fail(String(err));
      throw e;
    } finally {
      if ((log as any)?.close) await (log as any).close?.();
    }
  }, 30_000);
});
