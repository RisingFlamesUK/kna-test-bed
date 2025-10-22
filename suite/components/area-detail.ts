// suite/components/area-detail.ts
import type { Sev } from '../types/severity.ts';
import { loadJsonSafe, saveJson, suiteDetailPath, schemaDetailPath } from './detail-io.ts';

export type AreaStep = { severity: Sev; message: string };

function loadSteps(p: string): AreaStep[] {
  return loadJsonSafe<AreaStep[]>(p, []);
}

export function recordSuiteStep(severity: Sev, message: string) {
  const p = suiteDetailPath();
  if (!p) return;
  const cur = loadSteps(p);
  cur.push({ severity, message });
  saveJson(p, cur);
}

export function recordSchemaStep(severity: Sev, message: string) {
  const p = schemaDetailPath();
  if (!p) return;
  const cur = loadSteps(p);
  cur.push({ severity, message });
  saveJson(p, cur);
}
