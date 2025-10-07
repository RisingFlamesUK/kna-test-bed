import * as path from 'node:path';
import * as fs from 'fs-extra';
import { buildLogRoot } from './logger.ts';

export type ScenarioSeverity = 'ok' | 'warn' | 'fail';
const rank: Record<ScenarioSeverity, number> = { ok: 0, warn: 1, fail: 2 };

function worst(a: ScenarioSeverity, b: ScenarioSeverity): ScenarioSeverity {
  return rank[a] >= rank[b] ? a : b;
}

function storePathFromEnv(): string | null {
  const stamp = process.env.KNA_LOG_STAMP;
  if (!stamp) return null;
  // logs/<stamp>/e2e/_scenario-status.json
  return path.join(buildLogRoot(stamp), 'e2e', '_scenario-status.json');
}

export function recordScenarioSeverityFromEnv(scenario: string, next: ScenarioSeverity): void {
  const p = storePathFromEnv();
  if (!p) return;
  let data: Record<string, ScenarioSeverity> = {};
  try {
    const raw = fs.readFileSync(p, 'utf8');
    data = JSON.parse(raw) ?? {};
  } catch {
    /* ignore */
  }
  const prev = data[scenario] ?? 'ok';
  data[scenario] = worst(prev, next);
  fs.ensureDirSync(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}
