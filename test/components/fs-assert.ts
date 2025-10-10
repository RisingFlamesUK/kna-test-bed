import * as fs from 'node:fs';
import * as path from 'node:path';
import picomatch from 'picomatch';

import type { AssertFilesOptions } from '../../suite/types/fs-assert.ts';
import { logBoxCount } from '../../suite/components/proc.ts';
import { recordScenarioSeverityFromEnv } from '../../suite/components/scenario-status.ts';

/** Normalize to POSIX for globbing */
function toPosix(rel: string): string {
  return rel.replace(/\\/g, '/');
}

/** Return every FILE (no directories) relative to cwd, POSIX style */
function listAllFiles(cwd: string): string[] {
  const out: string[] = [];
  const stack: string[] = [cwd];
  while (stack.length) {
    const cur = stack.pop()!;
    const ents = fs.readdirSync(cur, { withFileTypes: true });
    for (const e of ents) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(abs);
      } else if (e.isFile()) {
        out.push(toPosix(path.relative(cwd, abs)));
      }
      // (symlinks: treat as files in a later pass if needed)
    }
  }
  return out.sort();
}

export async function assertFiles(opts: AssertFilesOptions): Promise<void> {
  const { cwd, manifest, logger, manifestLabel } = opts;

  const requiredPatterns = manifest.required ?? [];
  const forbiddenPatterns = manifest.forbidden ?? [];
  const ignorePatterns = manifest.ignore ?? [];

  // Step 5 with details (no separate runner step needed)
  logger.step('fs-assert: scanning sandbox');
  logger.write(`cwd=${cwd}`);
  logger.write(`manifest=${manifestLabel ?? '(inline manifest)'}`);

  // 1) Gather all files (incl. ignored)
  const allFiles = listAllFiles(cwd);

  const mmOpts = { dot: true, nocase: true } as const;
  const make = (pat: string) => picomatch(pat, mmOpts);

  // glob "magic" detector (keep simple + robust)
  const isGlob = (p: string) => /[*?[\]{}()!+@]/.test(p);

  // case-insensitive comparison by normalizing to lowercase
  const lc = (s: string) => s.toLowerCase();

  // 2) Filter ignored
  const isIgnoredFns = ignorePatterns.map(make);
  const isIgnored = (p: string) => isIgnoredFns.some((f) => f(p));
  const considered = allFiles.filter((p) => !isIgnored(p));
  const ignored = allFiles.length - considered.length;

  // fast lookups for exact (non-glob) patterns
  const consideredLCSet = new Set(considered.map(lc));
  const originalByLC = new Map(considered.map((p) => [lc(p), p]));

  // 3) Required: pattern → file matches
  const presentFiles = new Set<string>();
  const missingPatterns: string[] = [];

  for (const pat of requiredPatterns) {
    if (!isGlob(pat)) {
      const key = lc(pat);
      if (consideredLCSet.has(key)) {
        presentFiles.add(originalByLC.get(key)!);
      } else {
        missingPatterns.push(pat);
      }
      continue;
    }
    const fn = make(pat);
    const hits = considered.filter(fn);
    if (hits.length === 0) {
      missingPatterns.push(pat);
    } else {
      for (const h of hits) presentFiles.add(h);
    }
  }

  // 4) Forbidden: union of file hits across all forbidden patterns.
  const breachFiles = new Set<string>();
  for (const pat of forbiddenPatterns) {
    if (!isGlob(pat)) {
      const key = lc(pat);
      if (consideredLCSet.has(key)) breachFiles.add(originalByLC.get(key)!);
      continue;
    }
    const fn = make(pat);
    for (const f of considered) if (fn(f)) breachFiles.add(f);
  }

  // 5) Unexpected = considered − (presentFiles ∪ breachFiles)
  const unexpectedFiles = considered.filter((f) => !presentFiles.has(f) && !breachFiles.has(f));

  // 6) Counts
  const requiredCount = requiredPatterns.length; // patterns
  const forbiddenCount = forbiddenPatterns.length; // patterns
  const discovered = allFiles.length; // files (incl. ignored)
  const breach = breachFiles.size; // files
  const unexpected = unexpectedFiles.length; // files
  const missing = missingPatterns.length; // patterns
  const satisfied = requiredCount - missing; // patterns

  // 7) Condensed summary with per-section boxes immediately after each line
  logger.write(`Scaffolded output: ${discovered} files discovered`);

  logger.write(
    `- Required Files Test (${requiredCount} required): ${satisfied} satisfied, ${missing} missing`,
  );
  if (missing > 0) {
    const lines = missingPatterns.map((p) => `• ${p}`);
    logBoxCount(logger, 'Missing files', lines, `${missing} ${missing === 1 ? 'file' : 'files'}`);
  }

  logger.write(`- Forbidden Files Test (${forbiddenCount} forbidden): Outcome: ${breach} breach`);
  if (breach > 0) {
    const list = Array.from(breachFiles).sort();
    const lines = list.map((f) => `• ${f}`);
    logBoxCount(
      logger,
      'Forbidden files found',
      lines,
      `${breach} ${breach === 1 ? 'file' : 'files'}`,
    );
  }

  logger.write(`- Other Files Found: ${unexpected} unexpected, ${ignored} ignored`);
  if (unexpected > 0) {
    const list = unexpectedFiles.slice().sort();
    const lines = list.map((f) => `• ${f}`);
    logBoxCount(
      logger,
      'Unexpected files found',
      lines,
      `${unexpected} ${unexpected === 1 ? 'file' : 'files'}`,
    );
  }

  // Optional deep context (behind an env flag)
  if (process.env.E2E_DEBUG_FS_ASSERT === '1') {
    const cap = 300;
    const lines = [
      `All files (first ${Math.min(allFiles.length, cap)} of ${allFiles.length}):`,
      ...allFiles.slice(0, cap).map((e) => `  - ${e}`),
    ];
    logBoxCount(logger, 'fs-assert context (debug)', lines, 'context');
  }

  // 8) Final status LAST
  if (missing > 0 || breach > 0) {
    recordScenarioSeverityFromEnv(opts.scenarioName ?? 'unknown', 'fail', {
      step: 'files',
      meta: { missingCount: missing, breachCount: breach, unexpectedCount: unexpected },
    });
    logger.fail('fs-assert: FAIL');
    throw new Error('fs-assert: required/forbidden checks failed');
  }
  if (unexpected > 0) {
    recordScenarioSeverityFromEnv(opts.scenarioName ?? 'unknown', 'warn', {
      step: 'files',
      meta: { missingCount: missing, breachCount: breach, unexpectedCount: unexpected },
    });
    if ('warn' in logger && typeof logger.warn === 'function') logger.warn('fs-assert: WARN');
    else logger.write('fs-assert: WARN');
    return;
  }
  recordScenarioSeverityFromEnv(opts.scenarioName ?? 'unknown', 'ok', { step: 'files' });
  logger.pass('fs-assert: OK');
}
