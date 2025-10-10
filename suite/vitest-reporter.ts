// suite/vitest-reporter.ts
import path from 'node:path';
import fs from 'fs-extra';
import type { RunnerTestFile, RunnerTask } from 'vitest';
import { buildSuiteLogPath, buildLogRoot, createLogger } from './components/logger.ts';
import { CIEmitter } from './components/ci-emitter.ts';
import type { Sev } from './types/severity.ts';

type VitestSummary = {
  files: Array<{
    path: string;
    tasks?: RunnerTask[];
    tests: Array<{
      name: string;
      state?: string;
      duration?: number;
    }>;
    counts?: {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
    };
  }>;
  totals: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
};

export default class SuiteReporter {
  // suite.log writer (unchanged behavior)
  private buffer: Array<{ line: string; indent?: number | string }> = [];
  private loggerInst: ReturnType<typeof createLogger> | null = null;
  private readonly BUL_IND: number | string = '+2';

  // CI streaming
  private ci = new CIEmitter();

  // progressive change tracking
  private lastScenarioDetailKey = '';
  private lastVitestSummaryKey = '';

  // memory for linking test names -> scenario log URL
  private scenarioLogByName = new Map<string, string>();
  private lastScenarioLogByFile = new Map<string, string>();

  private tryEnsureLogger(): void {
    if (this.loggerInst) return;
    const stamp = process.env.KNA_LOG_STAMP || '';
    if (!stamp) return;
    const suitePath = buildSuiteLogPath(stamp);
    this.loggerInst = createLogger(suitePath);
    for (const item of this.buffer) this.loggerInst.write(item.line, item.indent);
    this.buffer.length = 0;
  }

  private write(line: string, indent?: number | string): void {
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

  private getTestPath(task: RunnerTask | undefined): string | undefined {
    if (!task) return undefined;
    return (task as any)?.file?.filepath || (task as any)?.file?.name;
  }

  private shaKey(obj: unknown): string {
    try {
      return JSON.stringify(obj);
    } catch {
      return String(Math.random());
    }
  }

  onInit(): void {
    this.ci.startRun();
    const enableText =
      process.env.KNA_VITEST_TEXT === '1' ||
      process.argv.includes('--verbose') ||
      process.argv.includes('-v');
    if (enableText) this.write('tests attempted:');
  }

  onUserConsoleLog(log: { content: string; task?: RunnerTask }): void {
    const txt = log?.content ?? '';

    // suite steps / end
    {
      const mStep = /^\[KNA_SUITE_STEP\]\s+(.+)/.exec(txt);
      if (mStep?.[1]) this.ci.suiteStep(mStep[1].trim());
      const mEnd = /^\[KNA_SUITE_END\]\s+(.+)/.exec(txt);
      if (mEnd?.[1]) {
        // close with the given vitest-style line; counts are resolved later, give zeros now
        this.ci.suiteEnd(mEnd[1].trim(), 'e2e/suite-sentinel.log', { failed: 0, skipped: 0 });
      }
    }

    // schema steps / end
    {
      const mStep = /^\[KNA_SCHEMA_STEP\]\s+(.+)/.exec(txt);
      if (mStep?.[1]) this.ci.schemaStep(mStep[1].trim());
      const mEnd = /^\[KNA_SCHEMA_END\]\s+(.+)/.exec(txt);
      if (mEnd?.[1]) {
        // close with the given vitest-style line
        this.ci.schemaEnd(mEnd[1].trim(), 'e2e/prompt-map.schema.log', { failed: 0, skipped: 0 });
      }
    }

    // (optional) scenario vitest line
    const mScenVit = /^\[KNA_SCEN_VITEST\]\s+([^|]+)\|\s*(.+)/.exec(txt);
    if (mScenVit) {
      const [, , line] = mScenVit;
      // Extract duration if present in log.task
      const duration = log?.task?.result?.duration;
      this.ci.scenarioLine(line.trim(), duration);
    }

    // scenario log file mapping (used for suite.log links)
    const mLog = /\[SCENARIO_LOG\]\s+(.+)/.exec(txt);
    if (mLog?.[1]) {
      const rawPath = mLog[1].trim();
      const abs = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
      const key = this.fullName(log?.task);
      const filePath = this.getTestPath(log?.task);

      this.scenarioLogByName.set(key, abs);
      if (filePath) this.lastScenarioLogByFile.set(filePath, abs);
    }
  }

  onTaskUpdate(): void {
    // drive progressive CI from artifacts + known file layout
    const stamp = process.env.KNA_LOG_STAMP || '';
    if (!stamp) return;

    const root = buildLogRoot(stamp);
    const e2eDir = path.join(root, 'e2e');
    const scenDetailPath = path.join(e2eDir, '_scenario-detail.json');
    const vitestSummaryPath = path.join(e2eDir, '_vitest-summary.json');

    // Load and validate current file state
    const scenDetail = fs.pathExistsSync(scenDetailPath) ? fs.readJsonSync(scenDetailPath) : {};
    const vitest: VitestSummary = fs.pathExistsSync(vitestSummaryPath)
      ? fs.readJsonSync(vitestSummaryPath)
      : { files: [], totals: { total: 0, passed: 0, failed: 0, skipped: 0 } };

    // Check for changes
    const scenKey = this.shaKey(scenDetail);
    const sumKey = this.shaKey(vitest);
    const changed = scenKey !== this.lastScenarioDetailKey || sumKey !== this.lastVitestSummaryKey;
    if (!changed) return;
    this.lastScenarioDetailKey = scenKey;
    this.lastVitestSummaryKey = sumKey;

    // Process test summaries and output
    for (const file of vitest.files) {
      if (!file.path) continue;

      // Calculate test counts for this file
      const counts = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
      };

      for (const test of file.tests) {
        counts.total++;
        if (test.state === 'pass') counts.passed++;
        else if (test.state === 'fail') counts.failed++;
        else if (test.state === 'skip') counts.skipped++;
      }

      // Format paths
      const absPath = path.resolve(process.cwd(), file.path);
      const logPath = path.join('e2e', path.basename(file.path).replace(/\.ts$/, '.log'));

      // Determine test area and indent based on file type
      const { title, indent } = /test[\\/]+e2e[\\/]+suite\.test\.ts$/i.test(file.path)
        ? { title: 'Docker PG Environment', indent: undefined }
        : /test[\\/]+e2e[\\/]+scenarios[\\/]+_runner[\\/]+prompt-map\.schema\.test\.ts$/i.test(
              file.path,
            )
          ? { title: 'Scenario schema tests', indent: '  ' }
          : { title: file.tasks?.[0]?.name || 'Unknown Test Area', indent: undefined };

      // Start test area and output test steps
      this.ci.testAreaStart(title, absPath, indent);

      for (const test of file.tests) {
        const status: Sev = test.state === 'pass' ? 'ok' : test.state === 'fail' ? 'fail' : 'warn';
        this.ci.testStep(test.name, status, indent);
      }

      this.ci.testAreaEnd(`${path.basename(file.path)} • ${title}`, logPath, counts, indent);
    }

    // Handle scenario details
    const names: string[] = Object.keys(scenDetail).sort((a, b) => a.localeCompare(b));
    if (names.length) {
      const bases = Array.from(new Set(names.map((n) => n.replace(/-([^-.]+)$/, '')))).map((base) =>
        path.join('test', 'e2e', 'scenarios', base, 'config', 'tests.json'),
      );

      this.ci.scenarioOpen(bases.map((p) => path.resolve(p)));
      for (const name of names) {
        this.ci.scenarioTest(name);
        const d = scenDetail[name] || {};
        (['scaffold', 'env', 'files'] as const).forEach((step) => {
          const info = d[step];
          if (!info) return;
          const sev: Sev =
            info.severity === 'ok' || info.severity === 'warn' || info.severity === 'fail'
              ? info.severity
              : 'fail';
          this.ci.scenarioCheck(step, sev);
        });
        const done = d.scaffold?.severity && d.env?.severity && d.files?.severity;
        if (done) this.ci.scenarioDone(name, `e2e/${name}.log`);
      }

      // close summary when all done
      const rank: Record<Sev, number> = { ok: 0, warn: 1, fail: 2 };
      let ok = 0,
        warn = 0,
        fail = 0;
      for (const name of names) {
        const d = scenDetail[name] || {};
        const sevList = (['scaffold', 'env', 'files'] as const)
          .map((k) => d[k]?.severity)
          .filter(Boolean) as Sev[];
        const worst = sevList.reduce<Sev>((acc, s) => (rank[acc] >= rank[s] ? acc : s), 'ok');
        if (worst === 'fail') fail++;
        else if (worst === 'warn') warn++;
        else ok++;
      }
      this.ci.scenarioCloseSummary({ names, ok, warn, fail });
    }
  }

  onFinished(_files: RunnerTestFile[]): void {
    const enableText =
      process.env.KNA_VITEST_TEXT === '1' ||
      process.argv.includes('--verbose') ||
      process.argv.includes('-v');

    // At this point, all test areas are complete
    if (enableText) this.write('— end of tests —\n');
  }
}
