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
 * Expand a glob pattern to absolute file paths
 */
async function expandPattern(pattern: string): Promise<string[]> {
  const abs = path.isAbsolute(pattern) ? pattern : path.resolve(process.cwd(), pattern);

  // Check if it's a literal file (no glob characters)
  if (!pattern.includes('*') && !pattern.includes('?') && !pattern.includes('[')) {
    if (fs.existsSync(abs)) {
      return [abs];
    }
    return [];
  }

  // Use fast-glob for patterns
  const matches = await fg(pattern, {
    absolute: true,
    onlyFiles: true,
    dot: false,
  });

  return matches;
}

/**
 * Validate a single file against a schema using ajv-cli
 */
async function validateFile(
  filePath: string,
  schemaPath: string,
  log: ReturnType<typeof scenarioLoggerFromEnv>,
  ci: ReturnType<typeof createCI>,
  hierarchyContext: { area: string; config: string; testGroup: string; test: string },
): Promise<{ passed: boolean; errorCount: number; details?: string }> {
  const relativePath = getRelativePath(filePath);

  log.step(`Validating ${relativePath} with ajv-cli`);

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

    // Success
    log.write(`file: OK`);
    log.write(`errors: 0`);
    log.pass(`${filePath}: OK`);
    recordSchemaStep('ok', `${relativePath}: OK`);
    ci.testStep(`${relativePath}: OK`, 'ok', undefined, hierarchyContext);

    return { passed: true, errorCount: 0 };
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

      log.write(`file: FAILED`);
      log.write(`errors: ${errorCount}`);

      // Write boxed error details
      if (detailLines) {
        log.boxStart(`validation errors`);
        log.boxLine(detailLines);
        log.boxEnd(`end validation errors (${errorCount} error${errorCount !== 1 ? 's' : ''})`);
      }

      log.fail(`${filePath}: FAILED`);
      recordSchemaStep('fail', `${relativePath}: FAILED`);
      ci.testStep(`${relativePath}: FAILED`, 'fail', undefined, hierarchyContext);

      return { passed: false, errorCount, details: detailLines };
    } else {
      // Unexpected error format
      log.write(`file: FAILED`);
      log.write(`errors: unknown`);
      log.fail(`${filePath}: FAILED - ${errStr}`);
      recordSchemaStep('fail', `${relativePath}: FAILED`);
      ci.testStep(`${relativePath}: FAILED`, 'fail', undefined, hierarchyContext);

      return { passed: false, errorCount: 1, details: errStr };
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

  const ci = createCI(hierarchyContext);

  describe(config.describe ?? 'schema validation', () => {
    // eslint-disable-next-line vitest/expect-expect
    it(
      'validate all configured files against their schemas',
      async () => {
        let totalFailed = 0;

        // Expect the new `schema` shape: an array of test groups
        const groups = config.schema;

        if (!Array.isArray(groups) || groups.length === 0) {
          log.step('No schema test groups configured for validation');
          log.write('⚠️ No schema test groups configured');
          recordSchemaStep('skip', 'No schema test groups configured');
          await (log as any)?.close?.();
          return;
        }

        // Iterate groups and validate each named test inside
        for (const group of groups) {
          const groupName = group.testGroupName ?? group.it ?? '(group)';
          const testsObj = group.tests ?? {};
          for (const [testName, testEntry] of Object.entries(testsObj)) {
            const displayName = `${groupName} :: ${testName}`;
            const pattern = (testEntry as any).pattern as string | undefined;
            const schemaPath =
              ((testEntry as any).schema as string | undefined) || config.defaultSchema;

            if (!pattern) {
              log.step(`No pattern specified for test: ${displayName}`);
              log.write('⚠️ No pattern for test');
              recordSchemaStep('skip', `${displayName}: no pattern configured`);
              continue;
            }
            if (!schemaPath) {
              log.step(`No schema specified for test: ${displayName}`);
              log.write('⚠️ No schema for test');
              recordSchemaStep('skip', `${displayName}: no schema configured`);
              continue;
            }

            const files = await expandPattern(pattern);

            if (files.length === 0) {
              log.step(`Pattern matched no files: ${pattern}`);
              log.write('⚠️ No files matched');
              recordSchemaStep('skip', `${displayName}: no files matched`);
              continue;
            }

            // Validate each matched file
            for (const file of files) {
              const result = await validateFile(file, schemaPath, log, ci, hierarchyContext);
              if (!result.passed) {
                totalFailed++;
              }
            }
          }
        }

        // Explicit log line (absolute file URL)
        const stamp = process.env[ENV_LOG_STAMP] || '';
        const absLog = (
          stamp
            ? buildScenarioLogPath(stamp, 'schema-validation')
            : path.resolve(LOGS_DIR, 'latest', E2E_DIR, SCHEMA_LOG_FILE)
        )
          .replace(/\\/g, '/')
          .replace(/ /g, '%20');
        ci.write(`  - log: file:///${absLog}`, undefined, hierarchyContext);

        await (log as any)?.close?.();

        // Throw if any files failed
        if (totalFailed > 0) {
          throw new Error(
            `Schema validation failed: ${totalFailed} file${totalFailed !== 1 ? 's' : ''} invalid`,
          );
        }
      },
      SCHEMA_TEST_TIMEOUT_MS,
    ); // 1 minute - ajv validation can be slow for many files
  });
}
