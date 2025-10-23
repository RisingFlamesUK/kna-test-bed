// suite/components/detail-io.ts
import * as path from 'node:path';
import * as fs from 'fs-extra';
import { buildLogRoot } from './logger.ts';

export function stampFromEnv(): string | null {
  return process.env.KNA_LOG_STAMP || null;
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
  return path.join(buildLogRoot(stamp), 'e2e', '_suite-detail.json');
}

export function schemaDetailPath(): string | null {
  const stamp = stampFromEnv();
  if (!stamp) return null;
  return path.join(buildLogRoot(stamp), 'e2e', '_schema-detail.json');
}

export function scenarioDetailPath(): string | null {
  const stamp = stampFromEnv();
  if (!stamp) return null;
  return path.join(buildLogRoot(stamp), 'e2e', '_scenario-detail.json');
}
