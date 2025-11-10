// test/e2e/schema/_runner/schema-runner.ts
import { execa } from 'execa';
import fg from 'fast-glob';
import * as fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, it } from 'vitest';
import {
  scenarioLoggerFromEnv,
  buildScenarioLogPath,
} from '../../../../suite/components/logger.ts';
import { createCI } from '../../../../suite/components/ci.ts';
import { recordSchemaStep } from '../../../../suite/components/area-detail.ts';
import {
  ENV_LOG_STAMP,
  LOGS_DIR,
  E2E_DIR,
  SCHEMA_LOG_FILE,
} from '../../../../suite/components/constants.ts';
import { SCHEMA_TEST_TIMEOUT_MS } from '../../../components/test-constants.ts';
import type { SchemaConfigFile, SchemaFileEntry } from './types.ts';

/**
 * Helper to get relative path from project root for display
 */
function getRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, '/');
}

/**
 * Resolve schema path for a file entry
 */
function _getSchemaForEntry(entry: SchemaFileEntry, defaultSchema?: string): string {
  const schema = entry.schema || defaultSchema;
  if (!schema) {
    throw new Error(`No schema specified for pattern: ${entry.pattern} and no defaultSchema set`);
  }
  return schema;
}

/**
 * Validate a single file against a schema using ajv-cli
 * Returns validation result for detail JSON collection
 */
async function validateFile(
  filePath: string,
  schemaPath: string,
): Promise<{
  passed: boolean;
  errorCount: number;
  details?: string;
  ciStatus: 'ok' | 'fail';
  ciMessage: string;
}> {
  const relativePath = getRelativePath(filePath);

  try {
    await execa(
      'npx',
      [
        'ajv',
        'validate',
        '--spec',
        'draft2020',
        '-s',
        schemaPath,
        '-d',
        filePath,
        '--strict=false',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );

    return {
      passed: true,
      errorCount: 0,
      ciStatus: 'ok',
      ciMessage: `${relativePath}: OK`,
    };
  } catch (e: any) {
    const err = e?.stderr ?? e?.message ?? String(e);
    const errStr = String(err);

    // Parse validation errors from stderr
    const lines = errStr.split('\n');
    const invalidLineIdx = lines.findIndex((l) => l.includes('invalid'));

    if (invalidLineIdx >= 0) {
      // Extract JSON error details
      const jsonStart = invalidLineIdx + 1;
      let jsonEnd = jsonStart;
      let bracketCount = 0;
      let foundStart = false;

      for (let j = jsonStart; j < lines.length; j++) {
        if (lines[j].trim().startsWith('[')) {
          foundStart = true;
          bracketCount = 1;
          jsonEnd = j + 1;
        } else if (foundStart) {
          if (lines[j].includes('[')) bracketCount++;
          if (lines[j].includes(']')) bracketCount--;
          jsonEnd = j + 1;
          if (bracketCount === 0) break;
        }
      }

      const detailLines = lines.slice(jsonStart, jsonEnd).join('\n').trim();

      // Count errors
      let errorCount = 0;
      try {
        const parsed = JSON.parse(detailLines);
        if (Array.isArray(parsed)) errorCount = parsed.length;
      } catch {
        errorCount = 1;
      }

      return {
        passed: false,
        errorCount,
        details: detailLines,
        ciStatus: 'fail',
        ciMessage: `${relativePath}: FAILED`,
      };
    } else {
      return {
        passed: false,
        errorCount: 1,
        details: errStr,
        ciStatus: 'fail',
        ciMessage: `${relativePath}: FAILED`,
      };
    }
  }
}

/**
 * Main runner: loads schema config and executes validation tests
 */
export async function runSchemaTestsFromFile(configPath: string) {
  const abs = path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
  const raw = await readFile(abs, 'utf8');
  const config: SchemaConfigFile = JSON.parse(raw);

  const log = scenarioLoggerFromEnv('schema-validation');
  const testGroupName: string = config.describe ?? 'schema validation';
  const testName = 'validate all configured files against their schemas';

  const hierarchyContext = {
    area: 'schema',
    config: 'main',
    testGroup: testGroupName,
    test: testName,
  };

  const ci = createCI();

  describe(config.describe ?? 'schema validation', () => {
    // Expect the new `schema` shape: an array of test groups
    const groups = config.schema;

    if (!Array.isArray(groups) || groups.length === 0) {
      // eslint-disable-next-line vitest/expect-expect
      it('should have schema test groups configured', () => {
        log.step('No schema test groups configured for validation');
        log.write('⚠️ No schema test groups configured');
        recordSchemaStep('skip', 'No schema test groups configured');
        throw new Error('No schema test groups configured');
      });
      return;
    }

    // Create individual concurrent it() blocks for each file validation
    for (const group of groups) {
      const groupName = group.testGroupName ?? group.it ?? '(group)';
      const testsObj = group.tests ?? {};

      for (const [testName, testEntry] of Object.entries(testsObj)) {
        const displayName = `${groupName} :: ${testName}`;
        const pattern = (testEntry as any).pattern as string | undefined;
        const schemaPath =
          ((testEntry as any).schema as string | undefined) || config.defaultSchema;

        if (!pattern) {
          // eslint-disable-next-line vitest/expect-expect
          it(`${displayName} (skipped: no pattern)`, () => {
            log.step(`No pattern specified for test: ${displayName}`);
            log.write('⚠️ No pattern for test');
            recordSchemaStep('skip', `${displayName}: no pattern configured`);
          });
          continue;
        }
        if (!schemaPath) {
          // eslint-disable-next-line vitest/expect-expect
          it(`${displayName} (skipped: no schema)`, () => {
            log.step(`No schema specified for test: ${displayName}`);
            log.write('⚠️ No schema for test');
            recordSchemaStep('skip', `${displayName}: no schema configured`);
          });
          continue;
        }

        // Expand pattern synchronously at test definition time
        const files = fg.sync(pattern, { cwd: process.cwd(), absolute: true, onlyFiles: true });

        if (files.length === 0) {
          // eslint-disable-next-line vitest/expect-expect
          it(`${displayName} (skipped: no files matched)`, () => {
            log.step(`Pattern matched no files: ${pattern}`);
            log.write('⚠️ No files matched');
            recordSchemaStep('skip', `${displayName}: no files matched`);
          });
          continue;
        }

        // Create concurrent test for each matched file
        for (const file of files) {
          const fileDisplay = getRelativePath(file);

          // eslint-disable-next-line vitest/expect-expect
          it.concurrent(
            fileDisplay,
            async () => {
              const result = await validateFile(file, schemaPath);

              // Record step and emit CI event (detail JSON collection)
              recordSchemaStep(result.ciStatus === 'ok' ? 'ok' : 'fail', result.ciMessage);
              ci.testStep(result.ciMessage, result.ciStatus, undefined, hierarchyContext);

              if (!result.passed) {
                throw new Error(`Schema validation failed for ${fileDisplay}`);
              }
            },
            SCHEMA_TEST_TIMEOUT_MS,
          );
        }
      }
    }

    // Add a final test to write the complete log from detail JSON and close
    // eslint-disable-next-line vitest/expect-expect
    it('write complete log from results', async () => {
      // Read the schema detail JSON to get all results in order
      const stamp = process.env[ENV_LOG_STAMP] || '';
      const detailPath = stamp
        ? path.resolve(LOGS_DIR, stamp, E2E_DIR, '_schema-detail.json')
        : path.resolve(LOGS_DIR, 'latest', E2E_DIR, '_schema-detail.json');

      if (fs.existsSync(detailPath)) {
        const detailRaw = await readFile(detailPath, 'utf8');
        const details = JSON.parse(detailRaw);

        // Write sequentially numbered log entries
        if (Array.isArray(details)) {
          for (let i = 0; i < details.length; i++) {
            const entry = details[i];
            const num = i + 1;
            const message = entry.message || '';
            const isOk = entry.severity === 'ok';

            // Extract file path from message (format: "path/to/file: OK" or "path/to/file: FAILED")
            const filePath = message.replace(/:\s*(OK|FAILED)$/, '');
            const absPath = path.resolve(process.cwd(), filePath);

            log.write(`${num}) Validating ${filePath} with ajv-cli`);
            log.write(`   file: ${isOk ? 'OK' : 'FAILED'}`);
            log.write(`   errors: ${isOk ? '0' : 'unknown'}`);
            log.write(`  ${isOk ? '✅' : '❌'} ${absPath}: ${isOk ? 'OK' : 'FAILED'}`);
          }
        }
      }

      // Write log link
      const absLog = (
        stamp
          ? buildScenarioLogPath(stamp, 'schema-validation')
          : path.resolve(LOGS_DIR, 'latest', E2E_DIR, SCHEMA_LOG_FILE)
      )
        .replace(/\\/g, '/')
        .replace(/ /g, '%20');
      ci.write(`  - log: file:///${absLog}`, undefined, hierarchyContext);
      await (log as any)?.close?.();
    });
  });
}
