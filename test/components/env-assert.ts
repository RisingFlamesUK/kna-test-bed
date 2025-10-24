// test/components/env-assert.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '../../suite/types/logger.ts';
import { logBoxCount } from '../../suite/components/proc.ts';
import { recordScenarioSeverityFromEnv } from '../../suite/components/scenario-status.ts';

type ManifestSpec = {
  required?: string[];
  optional?: string[];
  /** Optional expectations for active (uncommented) key values. */
  expect?: Record<string, { equals?: string; pattern?: string }>;
  /** Optional: keys to ignore if unexpected (do not WARN). */
  ignoreUnexpected?: string[];
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
}): Promise<'ok' | 'warn' | 'fail'> {
  const { appDir, manifestPath, log } = opts;

  const envFile = path.join(appDir, '.env');
  if (!fs.existsSync(envFile)) {
    // Message before final status; style with a box for readability
    log?.write(`.env not found:`);
    logBoxCount(log, 'Missing file', [`• ${envFile}`], '1 file');
    recordScenarioSeverityFromEnv(opts.scenarioName ?? 'unknown', 'fail', {
      step: 'env',
      meta: { note: '.env file not found' },
    });
    log?.fail(`env-assert: FAIL`);
    throw new Error('.env missing');
  }
  const envText = fs.readFileSync(envFile, 'utf8');
  const { active, commented } = parseDotEnv(envText);

  if (!fs.existsSync(manifestPath)) {
    // Message before final status; style with a box for readability
    log?.write(`Manifest file not found:`);
    logBoxCount(log, 'Missing file', [`• ${manifestPath}`], '1 file');
    recordScenarioSeverityFromEnv(opts.scenarioName ?? 'unknown', 'fail', {
      step: 'env',
      meta: { note: 'env manifest not found' },
    });
    log?.fail(`env-assert: FAIL`);
    throw new Error('manifest missing');
  }
  const manifest = loadManifest(manifestPath);

  const required = new Set(manifest.required ?? []);
  const optional = new Set(manifest.optional ?? []);

  // Discovery summary (mirror fs-assert minimal style)
  const discoveredKeys = active.size + commented.size;
  log?.write(`Scaffolded .env: ${discoveredKeys} keys discovered`);

  // --- Required section ---
  const requiredCommented: string[] = [];
  const requiredMissing: string[] = [];
  let requiredSatisfied = 0;
  for (const key of required) {
    const isAct = active.has(key);
    const isCom = commented.has(key);
    if (isAct) requiredSatisfied++;
    else if (isCom) requiredCommented.push(key);
    else requiredMissing.push(key);
  }
  const requiredCount = required.size;
  const requiredMissingCount = requiredMissing.length;
  const requiredCommentedCount = requiredCommented.length;
  log?.write(
    `- Required Keys Test (${requiredCount} required): ${requiredSatisfied} satisfied, ${requiredMissingCount} missing, ${requiredCommentedCount} commented`,
  );
  if (requiredCommentedCount > 0) {
    const lines = requiredCommented.map((k) => `• # ${k}`);
    logBoxCount(
      log,
      'Commented required keys',
      lines,
      `${requiredCommentedCount} ${requiredCommentedCount === 1 ? 'key' : 'keys'}`,
    );
  }
  if (requiredMissingCount > 0) {
    const lines = requiredMissing.map((k) => `• ${k}`);
    logBoxCount(
      log,
      'Missing required keys',
      lines,
      `${requiredMissingCount} ${requiredMissingCount === 1 ? 'key' : 'keys'}`,
    );
  }

  // --- Optional section ---
  let optionalSatisfied = 0; // commented and not active
  const optionalMissing: string[] = [];
  const optionalActive: string[] = [];
  for (const key of optional) {
    const isAct = active.has(key);
    const isCom = commented.has(key);
    if (isAct) {
      optionalActive.push(key);
    } else if (isCom) {
      optionalSatisfied++;
    } else {
      optionalMissing.push(key);
    }
  }
  const optionalCount = optional.size;
  const optionalMissingCount = optionalMissing.length;
  const optionalActiveCount = optionalActive.length;
  log?.write(
    `- Optional Keys Test (${optionalCount} optional): ${optionalSatisfied} satisfied, ${optionalMissingCount} missing, ${optionalActiveCount} active`,
  );
  if (optionalMissingCount > 0) {
    const lines = optionalMissing.map((k) => `• ${k}`);
    logBoxCount(
      log,
      'Missing optional keys',
      lines,
      `${optionalMissingCount} ${optionalMissingCount === 1 ? 'key' : 'keys'}`,
    );
  }
  if (optionalActiveCount > 0) {
    const lines = optionalActive.map((k) => `• ${k}`);
    logBoxCount(
      log,
      'Active optional keys',
      lines,
      `${optionalActiveCount} ${optionalActiveCount === 1 ? 'key' : 'keys'}`,
    );
  }

  // --- Other/Unexpected section ---
  const allListed = new Set<string>([...required, ...optional]);
  const ignore = new Set(manifest.ignoreUnexpected ?? []);
  const unexpectedActive: string[] = [];
  const unexpectedCommented: string[] = [];
  const ignoredKeys: string[] = [];
  for (const key of active.keys()) {
    if (allListed.has(key)) continue;
    if (ignore.has(key)) {
      ignoredKeys.push(key);
      continue;
    }
    unexpectedActive.push(key);
  }
  for (const key of commented) {
    if (allListed.has(key)) continue;
    if (ignore.has(key)) {
      if (!ignoredKeys.includes(key)) ignoredKeys.push(key);
      continue;
    }
    unexpectedCommented.push(key);
  }
  const unexpectedCount = unexpectedActive.length + unexpectedCommented.length;
  const ignoredCount = ignoredKeys.length;
  log?.write(`- Other Keys Found: ${unexpectedCount} unexpected, ${ignoredCount} ignored`);
  if (unexpectedCount > 0) {
    const lines = [
      ...unexpectedActive.map((k) => `• ${k}`),
      ...unexpectedCommented.map((k) => `• # ${k}`),
    ];
    logBoxCount(
      log,
      'Unexpected keys found',
      lines,
      `${unexpectedCount} ${unexpectedCount === 1 ? 'key' : 'keys'}`,
    );
  }

  // --- Value expectations (only for active keys) ---
  const expectFailures: string[] = [];
  for (const [key, rule] of Object.entries(manifest.expect ?? {})) {
    const actual = active.get(key);
    if (actual == null) {
      expectFailures.push(`• ${key}: expected active; not found`);
      continue;
    }
    if (rule.equals !== undefined) {
      if (actual !== rule.equals) {
        expectFailures.push(
          `• ${key}: expected equals ${JSON.stringify(rule.equals)}, got ${JSON.stringify(actual)}`,
        );
      }
    } else if (rule.pattern !== undefined) {
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern);
      } catch {
        expectFailures.push(`• ${key}: invalid regex ${JSON.stringify(rule.pattern)}`);
        continue;
      }
      if (!re.test(actual)) {
        expectFailures.push(
          `• ${key}: expected pattern ${String(re)}, got ${JSON.stringify(actual)}`,
        );
      }
    }
  }
  if (expectFailures.length > 0) {
    logBoxCount(
      log,
      'Value expectation failures',
      expectFailures,
      `${expectFailures.length} ${expectFailures.length === 1 ? 'failure' : 'failures'}`,
    );
  }

  // Optional deep context (behind an env flag)
  if (process.env.E2E_DEBUG_ENV_ASSERT === '1') {
    const annotated = buildAnnotatedEnvLines(envText);
    logBoxCount(log, 'env-assert context (debug)', annotated, 'context');
  }

  // Decide final severity: FAIL > WARN > OK
  const isFail =
    requiredMissingCount > 0 ||
    requiredCommentedCount > 0 ||
    optionalMissingCount > 0 ||
    optionalActiveCount > 0 ||
    expectFailures.length > 0;
  const isWarn = !isFail && unexpectedCount > 0; // unexpected commented/active => WARN only when not failing

  if (isFail) {
    let note: string | undefined;
    if (requiredCommentedCount > 0) note = 'required keys commented';
    else if (optionalActiveCount > 0) note = 'optional keys active';
    else if (optionalMissingCount > 0) note = 'optional keys missing';
    else if (expectFailures.length > 0)
      note = `value expectation failures: ${expectFailures.length}`;

    recordScenarioSeverityFromEnv(opts.scenarioName ?? 'unknown', 'fail', {
      step: 'env',
      meta: {
        missingCount: requiredMissingCount + optionalMissingCount,
        unexpectedCount,
        note,
      },
    });
    log?.fail('env-assert: FAIL');
    throw new Error('env-assert: required/optional checks failed');
  }
  if (isWarn) {
    recordScenarioSeverityFromEnv(opts.scenarioName ?? 'unknown', 'warn', {
      step: 'env',
      meta: { unexpectedCount },
    });
    if ('warn' in (log as any) && typeof (log as any)?.warn === 'function')
      log?.warn('env-assert: WARN');
    else log?.write('env-assert: WARN');
    return 'warn';
  }
  recordScenarioSeverityFromEnv(opts.scenarioName ?? 'unknown', 'ok', { step: 'env' });
  log?.pass('env-assert: OK');
  return 'ok';
}
