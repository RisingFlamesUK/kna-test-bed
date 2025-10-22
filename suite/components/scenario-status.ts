// suite/components/scenario-status.ts
import * as path from 'node:path';
import * as fs from 'fs-extra';
import { scenarioDetailPath } from './detail-io.ts';

export type ScenarioSeverity = 'ok' | 'warn' | 'fail';
const rank: Record<ScenarioSeverity, number> = { ok: 0, warn: 1, fail: 2 };

function worst(a: ScenarioSeverity, b: ScenarioSeverity): ScenarioSeverity {
  return rank[a] >= rank[b] ? a : b;
}

// --- Per-step detail artifact (single source of truth) ---
export type ScenarioStep = 'scaffold' | 'env' | 'files';

export type ScenarioDetailMeta = {
  missingCount?: number;
  breachCount?: number;
  unexpectedCount?: number;
  note?: string;
};

export type ScenarioStepDetail = {
  severity: ScenarioSeverity;
  meta?: ScenarioDetailMeta;
};

export type ScenarioDetailStore = Record<
  string, // scenario name
  Partial<Record<ScenarioStep, ScenarioStepDetail>>
>;

function detailPathFromEnv(): string | null {
  return scenarioDetailPath();
}

function updateDetailArtifact(
  scenario: string,
  step: ScenarioStep,
  next: ScenarioSeverity,
  meta?: ScenarioDetailMeta,
): void {
  const p = detailPathFromEnv();
  if (!p) return;

  let data: ScenarioDetailStore = {};
  try {
    data = fs.readJsonSync(p);
  } catch {
    /* ignore */
  }

  const prev = data[scenario]?.[step]?.severity ?? 'ok';
  const merged: ScenarioStepDetail = {
    severity: worst(prev, next),
    meta: {
      ...(data[scenario]?.[step]?.meta ?? {}),
      ...(meta ?? {}),
    },
  };

  data[scenario] = data[scenario] || {};
  (data[scenario] as any)[step] = merged;

  fs.ensureDirSync(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

/**
 * Record scenario severity into the per-step detail artifact (_scenario-detail.json).
 *
 * NOTE: Prior versions also wrote a worst-of projection to _scenario-status.json.
 * That artifact is now removed; this function is retained for API compatibility.
 */
export function recordScenarioSeverityFromEnv(
  scenario: string,
  next: ScenarioSeverity,
  opts?: { step?: ScenarioStep; meta?: ScenarioDetailMeta },
): void {
  // If caller provides a step, update that step's detail.
  if (opts?.step) {
    updateDetailArtifact(scenario, opts.step, next, opts.meta);
    return;
  }

  // Back-compat safety: if no step is provided, project onto 'env'.
  // (All current callers in the repo pass a step; this is a safe fallback.)
  updateDetailArtifact(scenario, 'env', next, opts?.meta);
}
