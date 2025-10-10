// test/components/env-assert.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '../../suite/types/logger.ts';
import { logBox } from '../../suite/components/proc.ts';
import { recordScenarioSeverityFromEnv } from '../../suite/components/scenario-status.ts';

type ManifestSpec = {
  required?: string[];
  optional?: string[];
  /** Optional expectations for active (uncommented) key values. */
  expect?: Record<string, { equals?: string; pattern?: string }>;
};

type Seen = {
  active: Map<string, string>;
  commented: Set<string>;
};

function parseDotEnv(text: string): Seen {
  const active = new Map<string, string>();
  const commented = new Set<string>();

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // "# KEY=..." (commented assignment)
    const mComment = line.match(/^#\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (mComment) {
      commented.add(mComment[1]);
      continue;
    }

    if (line.startsWith('#')) continue;

    // "KEY=VALUE" (active assignment)
    const mActive = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (mActive) {
      const key = mActive[1];
      const val = (mActive[2] ?? '').trim();
      const valClean = val.replace(/\s+#.*$/, ''); // drop trailing inline comments
      active.set(key, valClean);
    }
  }
  return { active, commented };
}

/** Build an annotated version of .env lines for debugging. */
function buildAnnotatedEnvLines(text: string): string[] {
  const rawLines = text.split(/\r?\n/);

  // Trim only *trailing* blank lines to avoid a dangling "[·]" at the end.
  let end = rawLines.length;
  while (end > 0 && rawLines[end - 1].trim() === '') end--;

  const out: string[] = [];
  for (let i = 0; i < end; i++) {
    const raw = rawLines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      out.push('[·]'); // blank line
      continue;
    }

    // Commented assignment like: "# KEY=..."
    if (/^#\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(trimmed)) {
      // Keep the raw line after the marker for readability
      out.push('[C] ' + raw.replace(/^#\s*/, '# '));
      continue;
    }

    // Active assignment like: "KEY=VALUE"
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(trimmed)) {
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      const key = m?.[1] ?? '';
      const val = (m?.[2] ?? '').replace(/\s+#.*$/, '');
      const masked = val === '' ? '(blank)' : '***';
      out.push(`[A] ${key}=${masked}`);
      continue;
    }

    // Plain comment line
    if (trimmed.startsWith('#')) {
      out.push('[#] ' + raw);
      continue;
    }

    // Anything else (very rare in .env files)
    out.push('[·] ' + raw);
  }

  return out;
}

function loadManifest(p: string): ManifestSpec {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw) as ManifestSpec;
}

export async function assertEnvMatches(opts: {
  appDir: string;
  manifestPath: string;
  log?: Logger;
  /** For scenario-level severity aggregation */
  scenarioName?: string;
}): Promise<void> {
  const { appDir, manifestPath, log } = opts;

  const envFile = path.join(appDir, '.env');
  if (!fs.existsSync(envFile)) {
    log?.fail(`.env not found at: ${envFile}`);
    recordScenarioSeverityFromEnv(opts.scenarioName ?? 'unknown', 'fail', { step: 'env' });
    throw new Error('.env missing');
  }
  const envText = fs.readFileSync(envFile, 'utf8');
  const { active, commented } = parseDotEnv(envText);

  if (!fs.existsSync(manifestPath)) {
    log?.fail(`Manifest file not found at: ${manifestPath}`);
    recordScenarioSeverityFromEnv(opts.scenarioName ?? 'unknown', 'fail', { step: 'env' });
    throw new Error('manifest missing');
  }
  const manifest = loadManifest(manifestPath);

  const required = new Set(manifest.required ?? []);
  const optional = new Set(manifest.optional ?? []);

  log?.write(
    `manifest: required=${required.size}, optional=${optional.size}; seen: active=${active.size}, commented=${commented.size}`,
  );

  // 1) Required must be present as active (value may be blank)
  const missingRequired: string[] = [];
  for (const key of required) {
    if (!active.has(key)) missingRequired.push(key);
  }

  // 2) Optional must exist but be commented (not active)
  const missingOptional: string[] = [];
  const optionalActive: string[] = [];
  for (const key of optional) {
    const isCommented = commented.has(key);
    const isActive = active.has(key);
    if (!isCommented) missingOptional.push(key);
    if (isActive) optionalActive.push(key);
  }

  // 3) Value expectations (only for active keys)
  const expectFailures: string[] = [];
  for (const [key, rule] of Object.entries(manifest.expect ?? {})) {
    if (!active.has(key)) {
      expectFailures.push(`Expected active key not found: ${key}`);
      continue;
    }
    const actual = active.get(key) ?? '';
    if (rule.equals !== undefined) {
      if (actual !== rule.equals) {
        expectFailures.push(
          `Value mismatch for ${key}: expected equals ${JSON.stringify(rule.equals)}, got ${JSON.stringify(actual)}`,
        );
      }
    } else if (rule.pattern !== undefined) {
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern);
      } catch {
        expectFailures.push(`Invalid regex for ${key}: ${JSON.stringify(rule.pattern)}`);
        continue;
      }
      if (!re.test(actual)) {
        expectFailures.push(
          `Value mismatch for ${key}: expected pattern ${String(re)}, got ${JSON.stringify(actual)}`,
        );
      }
    }
  }

  const hasFailures =
    missingRequired.length > 0 ||
    missingOptional.length > 0 ||
    optionalActive.length > 0 ||
    expectFailures.length > 0;

  if (hasFailures) {
    if (missingRequired.length) log?.fail('Missing required   : ' + missingRequired.join(', '));
    if (missingOptional.length) log?.fail('Optional missing   : ' + missingOptional.join(', '));
    if (optionalActive.length) log?.fail('Optional active     : ' + optionalActive.join(', '));
    for (const f of expectFailures) log?.fail(f);

    // Annotated dump to see exactly what the parser saw
    const annotated = buildAnnotatedEnvLines(envText);
    logBox(log, 'Scaffolded .env (annotated)', annotated, [
      'Legend:',
      ' [A] active assignment',
      ' [C] commented assignment',
      ' [#] comment',
      ' [·] blank/other',
    ]);

    recordScenarioSeverityFromEnv(opts.scenarioName ?? 'unknown', 'fail', { step: 'env' });
    throw new Error('env assertion failed');
  }
  recordScenarioSeverityFromEnv(opts.scenarioName ?? 'unknown', 'ok', { step: 'env' });
  log?.pass('Env assert passed');
}
