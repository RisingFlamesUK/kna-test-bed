// test/components/env-assert.ts
import path from 'node:path';

import fs from 'fs-extra';

import { scenarioLoggerFromEnv, type Logger } from '../../suite/components/logger.ts';

export type EnvManifest = {
  required?: string[];
  optional?: string[];
};

type Seen = {
  uncommented: Set<string>;
  commented: Set<string>;
};

function parseDotEnvLines(text: string): Seen {
  const uncommented = new Set<string>();
  const commented = new Set<string>();
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) continue;

    // Commented assignment: "# KEY=VALUE" (allow spaces after '#')
    const mComment = line.match(/^#\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (mComment) {
      commented.add(mComment[1]);
      continue;
    }

    // Pure comments → ignore
    if (line.startsWith('#')) continue;

    // Active assignment: "KEY=VALUE"
    const mActive = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (mActive) {
      uncommented.add(mActive[1]);
    }
  }

  return { uncommented, commented };
}

export async function assertEnvMatches({
  appDir,
  manifestPath,
  envFile = '.env',
  log,
  scenarioName,
}: {
  appDir: string;
  manifestPath: string;
  envFile?: string;
  log?: Logger;
  scenarioName?: string;
}): Promise<void> {
  const logger = log ?? (scenarioName ? scenarioLoggerFromEnv(scenarioName) : undefined);

  logger?.step('Env: validate .env against manifest');
  const absEnv = path.resolve(appDir, envFile);
  const absManifest = path.resolve(manifestPath);
  logger?.write(`envFile=${absEnv}`);
  logger?.write(`manifest=${absManifest}`);

  if (!(await fs.pathExists(absEnv))) {
    logger?.fail('.env file not found');
    throw new Error(`.env not found at: ${absEnv}`);
  }
  if (!(await fs.pathExists(absManifest))) {
    logger?.fail('Manifest file not found');
    throw new Error(`env manifest not found at: ${absManifest}`);
  }

  const [envText, manifest] = await Promise.all([
    fs.readFile(absEnv, 'utf8'),
    fs.readJson(absManifest) as Promise<EnvManifest>,
  ]);

  const { uncommented, commented } = parseDotEnvLines(envText);
  const required = new Set(manifest.required ?? []);
  const optional = new Set(manifest.optional ?? []);

  logger?.write(
    `manifest: required=${required.size}, optional=${optional.size}; seen: active=${uncommented.size}, commented=${commented.size}`,
  );

  const missingRequired: string[] = [];
  const miscommentedRequired: string[] = [];
  for (const key of required) {
    if (!uncommented.has(key) && !commented.has(key)) {
      missingRequired.push(key);
    } else if (commented.has(key) && !uncommented.has(key)) {
      miscommentedRequired.push(key);
    }
  }

  const missingOptional: string[] = [];
  const misactivatedOptional: string[] = [];
  for (const key of optional) {
    if (!commented.has(key) && !uncommented.has(key)) {
      missingOptional.push(key);
    } else if (uncommented.has(key)) {
      misactivatedOptional.push(key);
    }
  }

  if (
    missingRequired.length ||
    miscommentedRequired.length ||
    missingOptional.length ||
    misactivatedOptional.length
  ) {
    logger?.fail('Env assert failed');
    if (missingRequired.length) {
      logger?.write('- Missing required   : ' + missingRequired.join(', '));
    }
    if (miscommentedRequired.length) {
      logger?.write('- Required commented : ' + miscommentedRequired.join(', '));
    }
    if (missingOptional.length) {
      logger?.write('- Missing optional   : ' + missingOptional.join(', '));
    }
    if (misactivatedOptional.length) {
      logger?.write('- Optional active    : ' + misactivatedOptional.join(', '));
    }

    const msg = [
      `Scaffolded .env at ${absEnv} did not match manifest ${absManifest}:`,
      missingRequired.length ? `Missing required: ${missingRequired.join(', ')}` : '',
      miscommentedRequired.length
        ? `Required present but commented: ${miscommentedRequired.join(', ')}`
        : '',
      missingOptional.length ? `Missing optional: ${missingOptional.join(', ')}` : '',
      misactivatedOptional.length
        ? `Optional active (should be commented): ${misactivatedOptional.join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    throw new Error(msg);
  }

  logger?.pass('Env assert passed');
}
