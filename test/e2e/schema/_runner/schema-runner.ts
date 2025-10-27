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
function getSchemaForEntry(entry: SchemaFileEntry, defaultSchema?: string): string {
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

      return { passed: false, errorCount, details: detailLines };
    } else {
      // Unexpected error format
      log.write(`file: FAILED`);
      log.write(`errors: unknown`);
      log.fail(`${filePath}: FAILED - ${errStr}`);
      recordSchemaStep('fail', `${relativePath}: FAILED`);

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
  const ci = createCI();

  // Tell reporter to show config file in header
  console.log(`/* CI: AreaFile ${abs} */`);

  // eslint-disable-next-line vitest/valid-title
  describe(config.describe ?? 'schema validation', () => {
    // eslint-disable-next-line vitest/expect-expect
    it('validated all configured files against their schemas', async () => {
      let totalFailed = 0;

      if (config.files.length === 0) {
        log.step('No files configured for validation');
        log.write('⚠️ No files configured');
        recordSchemaStep('skip', 'No files configured');
        await (log as any)?.close?.();
        return;
      }

      // Process each file entry
      for (const entry of config.files) {
        const schema = getSchemaForEntry(entry, config.defaultSchema);
        const files = await expandPattern(entry.pattern);

        if (files.length === 0) {
          log.step(`Pattern matched no files: ${entry.pattern}`);
          log.write('⚠️ No files matched');
          recordSchemaStep('skip', `${entry.name}: no files matched`);
          continue;
        }

        // Validate each matched file
        for (const file of files) {
          const result = await validateFile(file, schema, log);
          if (!result.passed) {
            totalFailed++;
          }
        }
      }

      // Explicit log line (absolute file URL)
      const stamp = process.env.KNA_LOG_STAMP || '';
      const absLog = (
        stamp
          ? buildScenarioLogPath(stamp, 'schema-validation')
          : path.resolve('logs', 'latest', 'e2e', 'schema-validation.log')
      )
        .replace(/\\/g, '/')
        .replace(/ /g, '%20');
      ci.write(`log: file:///${absLog}`);

      await (log as any)?.close?.();

      // Throw if any files failed
      if (totalFailed > 0) {
        throw new Error(
          `Schema validation failed: ${totalFailed} file${totalFailed !== 1 ? 's' : ''} invalid`,
        );
      }
    }, 60_000);
  });
}
