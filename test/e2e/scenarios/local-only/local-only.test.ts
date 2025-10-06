import path from 'node:path';

import fs from 'fs-extra';
import { describe, it, expect } from 'vitest';

import { assertScaffoldCommand } from '../../../components/scaffold-command-assert.ts';
import { assertEnvMatches } from '../../../components/env-assert.ts';
import { scenarioLoggerFromEnv } from '../../../../suite/components/logger.ts';
import type { Prompt } from '../../../components/interactive-driver.ts';

// Prompts must match your generator’s actual questions (regex on aggregated stdout)
const prompts: Prompt[] = [
  // 1) Include PostgreSQL? (y/N) → Yes
  { expect: /Include\s+PostgreSQL\?/i, send: 'y\n' },

  // 2) Enable session management? (y/N) → Yes
  { expect: /Enable\s+session\s+management\?/i, send: 'y\n' },

  // 3) Include Axios? (y/N) → No (default)
  { expect: /Include\s+Axios\?/i, send: 'n\n' },

  // 4) Use Passport.js authentication? (y/N) → Yes
  { expect: /Use\s+Passport\.js\s+authentication\?/i, send: 'y\n' },

  // 5) Select Passport strategies (checkbox). Select "local"
  {
    type: 'checkbox',
    expect: /Select\s+Passport\s+strategies/i,
    select: ['local'],
    submit: true,
    required: true,
  },

  // 6–10) Postgres settings — leave blank to accept defaults (press Enter five times)
  { expect: /postgres.*user|pg_?user/i, send: '\n' },
  { expect: /password|pg_?pass/i, send: '\n' },
  { expect: /database|pg_?db/i, send: '\n' },
  { expect: /host|pg_?host/i, send: '\n' },
  { expect: /port|pg_?port/i, send: '\n' },
];

describe('local-only scaffold', () => {
  it('silent mode: scaffolds app without errors', async () => {
    const log = scenarioLoggerFromEnv('local-only-silent');

    const { appDir, cleanup } = await assertScaffoldCommand({
      scenarioName: 'local-only-silent',
      flags: ['--silent', '--passport', 'local'], // minimal, non-interactive
      log,
    });

    try {
      expect(await fs.pathExists(appDir)).toBe(true);
      await assertEnvMatches({
        appDir,
        manifestPath: 'test/e2e/scenarios/local-only/manifest/env.json',
        log,
      });
    } finally {
      await cleanup();
    }
  });

  // answers-file test only runs if the file exists locally
  const answersPath = path.resolve('test/e2e/scenarios/local-only/config/answers.json');
  const hasAnswers = fs.pathExistsSync(answersPath);

  (hasAnswers ? it : it.skip)('answers-file mode: scaffolds app without errors', async () => {
    const log = scenarioLoggerFromEnv('local-only-answers');
    const { appDir, cleanup } = await assertScaffoldCommand({
      scenarioName: 'local-only-answers',
      flags: [], // ignored when answersFile is set (component policy)
      answersFile: answersPath, // use seeded answers; non-interactive
      log,
    });

    try {
      expect(await fs.pathExists(appDir)).toBe(true);
      await assertEnvMatches({
        appDir,
        manifestPath: 'test/e2e/scenarios/local-only/manifest/env.json',
        log,
      });
    } finally {
      await cleanup();
    }
  });

  // interactive test only
  it('interactive mode: scaffolds app without errors (prompts)', async () => {
    const log = scenarioLoggerFromEnv('local-only-interactive');
    const { appDir, cleanup } = await assertScaffoldCommand({
      scenarioName: 'local-only-interactive',
      flags: [], // no --silent, no answersFile => interactive prompts
      log,
      interactive: { prompts },
      keepArtifacts: false, // set true while iterating locally to inspect output
    });

    try {
      expect(await fs.pathExists(appDir)).toBe(true);
      await assertEnvMatches({
        appDir,
        manifestPath: 'test/e2e/scenarios/local-only/manifest/env.json',
        log,
      });
    } finally {
      await cleanup();
    }
  }, 120_000);
});
