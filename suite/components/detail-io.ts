// suite/components/detail-io.ts
import * as path from 'node:path';
import * as fs from 'fs-extra';
import { buildLogRoot } from './logger.ts';
import {
  ENV_LOG_STAMP,
  SUITE_DETAIL_FILE,
  SCHEMA_DETAIL_FILE,
  SCENARIO_DETAIL_FILE,
  E2E_DIR,
} from './constants.ts';

export function stampFromEnv(): string | null {
  return process.env[ENV_LOG_STAMP] || null;
}

export function ensureDir(p: string) {
  fs.ensureDirSync(path.dirname(p));
}

export function loadJsonSafe<T>(p: string, fallback: T): T {
  try {
    return fs.readJsonSync(p) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(p: string, data: any) {
  ensureDir(p);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export function suiteDetailPath(): string | null {
  const stamp = stampFromEnv();
  if (!stamp) return null;
  return path.join(buildLogRoot(stamp), E2E_DIR, SUITE_DETAIL_FILE);
}

export function schemaDetailPath(): string | null {
  const stamp = stampFromEnv();
  if (!stamp) return null;
  return path.join(buildLogRoot(stamp), E2E_DIR, SCHEMA_DETAIL_FILE);
}

export function scenarioDetailPath(): string | null {
  const stamp = stampFromEnv();
  if (!stamp) return null;
  return path.join(buildLogRoot(stamp), E2E_DIR, SCENARIO_DETAIL_FILE);
}
