import path from 'node:path';

import fs from 'fs-extra';
import { describe, it, expect } from 'vitest';

import { assertScaffoldCommand } from '../../../components/scaffold-command-assert.ts';
import { assertEnvMatches } from '../../../components/env-assert.ts';
import { scenarioLoggerFromEnv } from '../../../../suite/components/logger.ts';

describe('local-only scaffold', () => {
  it('silent mode: scaffolds app without errors', async () => {
    const log = scenarioLoggerFromEnv('local-only-silent');

    const { appDir, cleanup } = await assertScaffoldCommand({
      scenarioName: 'local-only-silent',
      flags: ['--silent', '--passport', 'local'], // minimal, non-interactive
      log,
    });

    try {
      // Just sanity-check that the directory exists; assertScaffoldCommand already guarantees this
      expect(await fs.pathExists(appDir)).toBe(true);
      //assert .env
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
  const answersPath = path.resolve('test/e2e/scenarios/local-only/answers.json');
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
      //assert .env
      await assertEnvMatches({
        appDir,
        manifestPath: 'test/e2e/scenarios/local-only/manifest/env.json',
        log,
      });
    } finally {
      await cleanup();
    }
  });

  // interactive test only runs when explicitly enabled (avoid hanging CI)
  const runInteractive = process.env.E2E_INTERACTIVE === '1';
  (runInteractive ? it : it.skip)(
    'interactive mode: scaffolds app without errors (prompts)',
    async () => {
      const log = scenarioLoggerFromEnv('local-only-interactive');
      const { appDir, cleanup } = await assertScaffoldCommand({
        scenarioName: 'local-only-interactive',
        flags: [], // no --silent, no answersFile => interactive prompts
        log,
      });

      try {
        expect(await fs.pathExists(appDir)).toBe(true);
        //assert .env
        await assertEnvMatches({
          appDir,
          manifestPath: 'test/e2e/scenarios/local-only/manifest/env.json',
          log,
        });
      } finally {
        await cleanup();
      }
    },
  );
});
