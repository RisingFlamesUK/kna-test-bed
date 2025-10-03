// suite/vitest-reporter.ts
// Custom Vitest reporter: per-file, per-test summary into logs/<stamp>/suite.log
// - Vitest v3 Runner* types (no deprecations)
// - Buffers until KNA_LOG_STAMP is set by global-setup, then flushes via your logger
// - Indents output so "tests attempted:" aligns under "Run Tests"

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { RunnerTestFile, RunnerTask, RunnerTestCase } from 'vitest';

import { buildSuiteLogPath, createLogger } from './components/logger.ts';

export default class SuiteReporter {
  private printedHeader = false;
  private scenarioLogByName = new Map<string, string>();
  private lastScenarioLog: string | null = null;
  // Fallback when task is missing: remember last scenario log by file
  private lastScenarioLogByFile = new Map<string, string>();

  // buffer until we can resolve KNA_LOG_STAMP
  private buffer: Array<{ line: string; indent?: number | string }> = [];
  private loggerInst: ReturnType<typeof createLogger> | null = null;

  // Indentation: align under "Run Tests"
  // If your step numbers reach 10+ (e.g., "10) Run Tests"), you might prefer 4.
  private readonly BUL_IND: number | string = '+2'; // bullets under headers (step indent + 2)

  private tryEnsureLogger(): void {
    if (this.loggerInst) return;
    const stamp = process.env.KNA_LOG_STAMP || '';
    if (!stamp) return; // still too early — keep buffering
    const suitePath = buildSuiteLogPath(stamp);
    this.loggerInst = createLogger(suitePath);
    for (const item of this.buffer) this.loggerInst.write(item.line, item.indent);
    this.buffer.length = 0;
  }

  private write(line: string, indent?: number | string) {
    this.tryEnsureLogger();
    if (this.loggerInst) this.loggerInst.write(line, indent);
    else this.buffer.push({ line, indent });
  }

  private fullName(task: RunnerTask | undefined): string {
    if (!task) return '';
    const parts: string[] = [];
    let cur: RunnerTask | undefined = task;
    while (cur) {
      if (cur.name) parts.unshift(cur.name);
      cur = (cur as any).suite as RunnerTask | undefined;
    }
    return parts.filter(Boolean).join(' > ');
  }

  onInit() {
    if (!this.printedHeader) {
      // No empty line here — prints immediately under "5) Run Tests"
      this.write('tests attempted:');
      this.printedHeader = true;
    }
  }

  onUserConsoleLog(log: { content: string; task?: RunnerTask }) {
    // Optional: capture scenario log path from helper/tests
    const m = /\[SCENARIO_LOG\]\s+(.+)/.exec(log?.content ?? '');
    if (!m || !m[1]) return;

    const rawPath = m[1].trim();
    // Normalize to absolute file:// URL so it's clickable in suite.log
    const abs = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
    const fileUrl = pathToFileURL(abs).toString();

    const key = this.fullName(log?.task);

    // Try to capture the originating file when available
    const filePath = (log?.task as any)?.file?.filepath || (log?.task as any)?.file?.name || null;

    if (key) {
      // Map by fully-qualified test name
      this.scenarioLogByName.set(key, fileUrl);
    }

    if (filePath) {
      // Also remember a per-file fallback so we never cross-link between files
      this.lastScenarioLogByFile.set(path.resolve(filePath), fileUrl);
    }
  }

  onFinished(files: RunnerTestFile[]) {
    const cwd = process.cwd();

    for (const file of files) {
      const filePath = (file as any).filepath || (file as any).name || '(unknown)';
      const rel = path.relative(cwd, filePath);

      // First pass: counts
      let total = 0,
        passed = 0,
        failed = 0,
        skipped = 0;

      const walkCount = (t: RunnerTask) => {
        const kids = (t as any).tasks as RunnerTask[] | undefined;
        if (!kids || kids.length === 0) {
          total++;
          const test = t as unknown as RunnerTestCase;
          const state = test.result?.state;
          const isSkip =
            state === 'skip' || (test as any).mode === 'skip' || (test as any).mode === 'todo';
          if (state === 'pass') passed++;
          else if (isSkip) skipped++;
          else if (state === 'fail') failed++;
          else failed++;
          return;
        }
        for (const c of kids) walkCount(c);
      };
      walkCount(file as unknown as RunnerTask);

      // File header (indented under "Run Tests")
      this.write(
        `${rel}  (tests: ${total}, passed: ${passed}, failed: ${failed}, skipped: ${skipped})`,
        this.BUL_IND,
      );

      // Second pass: individual test lines
      const walkLines = (t: RunnerTask) => {
        const kids = (t as any).tasks as RunnerTask[] | undefined;
        if (!kids || kids.length === 0) {
          const test = t as unknown as RunnerTestCase;
          const state = test.result?.state;
          const isSkip =
            state === 'skip' || (test as any).mode === 'skip' || (test as any).mode === 'todo';
          const isPass = state === 'pass';
          const isFail = state === 'fail';

          let mark = '❓';
          if (isPass) mark = '✅';
          else if (isSkip) mark = '↩️';
          else if (isFail) mark = '❌';

          const dur =
            test.result?.duration != null ? ` (${Math.round(test.result.duration)}ms)` : '';

          const key = this.fullName(test);

          // 1) Direct match by full test name
          let link = this.scenarioLogByName.get(key);

          // 2) Fallback: by file (never cross-file)
          if (!link) {
            const fpath =
              (test as any)?.file?.filepath ||
              (test as any)?.file?.name ||
              (file as any).filepath ||
              (file as any).name ||
              '';
            const resolved = fpath ? path.resolve(fpath) : '';
            if (resolved) {
              const byFile = this.lastScenarioLogByFile.get(resolved);
              if (byFile) {
                link = byFile;
                this.lastScenarioLogByFile.delete(resolved);
              }
            }
          }

          const suffix = link ? `  ${link}` : '';

          this.write(`• ${mark} ${this.fullName(test)}${dur}${suffix}`, this.BUL_IND);
          return;
        }
        for (const c of kids) walkLines(c);
      };
      walkLines(file as unknown as RunnerTask);
    }

    this.write(`— end of tests —\n`);

    // Safety: if stamp never appeared, we leave the buffered lines;
    // global-setup should always set KNA_LOG_STAMP in this project.
  }
}
