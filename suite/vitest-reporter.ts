// suite/vitest-reporter.ts
import type { RunnerTestFile, RunnerTask } from 'vitest';
import type { Reporter } from 'vitest/reporter';
import { createCI } from './components/ci.ts';
import * as fs from 'fs';
import * as path from 'path';
import { buildScenarioLogPath } from './components/logger.ts';
import { getPreReleaseVersion } from './components/pre-release.ts';

// Simple test-focused reporter to help debug test output
export default class TestReporter implements Reporter {
  private ci = createCI();
  // All maps are keyed by normalized absolute file path key (lowercased posix)
  private areas = new Map<
    string,
    {
      name: string;
      filePathAbs: string; // absolute path used for header URL
      counts: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
        warning: number;
      };
      meta: {
        totalTests: number;
        finishedTests: number;
      };
    }
  >();
  private currentAreaKey: string | null = null;
  // Map test task id -> task (for quick lookup during onTaskUpdate)
  private taskById = new Map<string, RunnerTask>();
  // Track tests we already printed to avoid duplicates on repeated updates
  private printedTests = new Set<string>();
  // Track which file areas have been closed (footer printed)
  private closedAreas = new Set<string>();
  // Buffer of per-file lines and flags
  private buffers = new Map<string, { lines: string[]; hasExplicitLog: boolean }>();
  // Track printed explicit log lines to avoid duplicates (per file)
  private printedLogLinesByFile = new Map<string, Set<string>>();
  // Area order and streaming control
  private fileQueue: string[] = []; // keys
  private activeFileKey: string | null = null;
  private headerStarted = new Set<string>();
  private finished = new Set<string>();
  private startedFiles = new Set<string>();
  private runStartMs = Date.now();
  private firstEventByFile = new Map<
    string,
    { when: number; source: 'console' | 'task'; snippet: string }
  >();
  // Track collection across multiple onCollected calls and queue state
  private collectedKeys = new Set<string>();
  private queueFinalized = false; // set true once streaming starts so we stop reordering
  private plannedOrderPrinted = false;
  // Debounce closing to let late console logs flush per file
  private closeTimers = new Map<string, NodeJS.Timeout>();
  private readonly CLOSE_DELAY_MS = 35;
  // Track bullets printed per file (by test name) to avoid duplicates
  private bulletsByFile = new Map<string, Set<string>>();
  // Track which scenario names had their step lines printed per file
  private scenarioStepsPrinted = new Map<string, Set<string>>();
  // Track which scenario names had their mergeEnv skip line printed per file
  private scenarioSkipPrinted = new Map<string, Set<string>>();
  // Track last scenario name seen from a bullet for each file (to map test to scenario)
  private lastScenarioByFile = new Map<string, string>();
  // Track last printed test title per file so arriving logs can attach immediately
  private lastPrintedTestTitleByFile = new Map<string, string>();
  // Defer per-scenario log lines (so they print after the test summary): fileKey -> testTitle -> logLine
  private scenarioLogsByFile = new Map<string, Map<string, string>>();
  // Generic deferred log lines for non-scenario areas: fileKey -> array of log lines
  private deferredLogsByFile = new Map<string, string[]>();
  // Track how many non-scenario steps we've printed per file (for Suite/Schema detail JSON)
  private nonScenarioPrintedCount = new Map<string, number>();
  // Track non-scenario group bullet printing and polling state
  private nonScenarioGroupBulletPrinted = new Set<string>();
  private nonScenarioPollers = new Map<string, NodeJS.Timeout>();
  // Track if we've emitted any log line (explicit or default) for non-scenario areas
  private nonScenarioLogEmitted = new Set<string>();

  private isScenarioAbs(abs: string): boolean {
    return /[\\/]test[\\/]e2e[\\/]scenarios[\\/]/i.test(abs.replace(/\\/g, '/'));
  }

  private getE2EDirForStamp(): string | null {
    const stamp = process.env.KNA_LOG_STAMP;
    if (!stamp) return null;
    return path.resolve('logs', stamp, 'e2e');
  }

  private getSuiteDetailPath(): string | null {
    const stamp = process.env.KNA_LOG_STAMP;
    if (!stamp) return null;
    return path.resolve('logs', stamp, 'e2e', '_suite-detail.json');
  }

  private getSchemaDetailPath(): string | null {
    const stamp = process.env.KNA_LOG_STAMP;
    if (!stamp) return null;
    return path.resolve('logs', stamp, 'e2e', '_schema-detail.json');
  }

  private isSuiteAreaByKey(fileKey: string): boolean {
    const area = this.areas.get(fileKey);
    const abs = ((area as any)?.meta?.testFileAbs ?? area?.filePathAbs ?? '').replace(/\\/g, '/');
    return /test\/e2e(?:\/suite)?\/suite\.test\.ts$/i.test(abs);
  }

  private isSchemaRunnerAreaByKey(fileKey: string): boolean {
    const area = this.areas.get(fileKey);
    const abs = ((area as any)?.meta?.testFileAbs ?? area?.filePathAbs ?? '').replace(/\\/g, '/');
    return /test\/e2e\/schema\/prompt-map\.schema\.test\.ts$/i.test(abs);
  }

  // Group bullets for non-scenario areas (Suite/Schema) are injected by the reporter
  private getNonScenarioGroupBullet(fileKey: string): string | null {
    if (this.isSuiteAreaByKey(fileKey)) return '• Testing Docker PG Environment...';
    if (this.isSchemaRunnerAreaByKey(fileKey)) return '• Validating prompt-map.json files...';
    return null;
  }

  private ensureNonScenarioGroupBullet(fileKey: string, ensureHeaderFor: string) {
    if (this.isScenarioAreaByKey(fileKey)) return; // scenarios manage their own per-test bullets
    if (this.nonScenarioGroupBulletPrinted.has(fileKey)) return;
    const bullet = this.getNonScenarioGroupBullet(fileKey);
    if (!bullet) return;
    if (this.activeFileKey === fileKey) {
      this.ensureHeader(ensureHeaderFor);
      this.ci.boxLine(bullet);
    } else {
      const buf = this.buffers.get(fileKey) || { lines: [], hasExplicitLog: false };
      this.buffers.set(fileKey, buf);
      buf.lines.push(bullet);
    }
    this.nonScenarioGroupBulletPrinted.add(fileKey);
  }

  private loadNonScenarioSteps(
    fileKey: string,
  ): Array<{ severity: 'ok' | 'warn' | 'fail' | 'skip'; message: string }> {
    try {
      let p: string | null = null;
      if (this.isSuiteAreaByKey(fileKey)) p = this.getSuiteDetailPath();
      else if (this.isSchemaRunnerAreaByKey(fileKey)) p = this.getSchemaDetailPath();
      if (!p) return [];
      const raw = fs.readFileSync(p, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  private ensureNonScenarioStepsPrinted(fileKey: string, ensureHeaderFor: string) {
    if (this.isScenarioAreaByKey(fileKey)) return;
    const steps = this.loadNonScenarioSteps(fileKey);
    const already = this.nonScenarioPrintedCount.get(fileKey) || 0;
    if (steps.length <= already) return;
    for (let i = already; i < steps.length; i++) {
      const s = steps[i];
      const icon =
        s.severity === 'fail'
          ? '❌'
          : s.severity === 'warn'
            ? '⚠️'
            : s.severity === 'skip'
              ? '↩️'
              : '✅';
      const line = `- ${icon} ${s.message}`;
      if (this.activeFileKey === fileKey) {
        this.ensureHeader(ensureHeaderFor);
        this.ci.boxLine(line);
      } else {
        const buf = this.buffers.get(fileKey) || { lines: [], hasExplicitLog: false };
        this.buffers.set(fileKey, buf);
        buf.lines.push(line);
      }
    }
    this.nonScenarioPrintedCount.set(fileKey, steps.length);
  }

  private startNonScenarioPolling(fileKey: string, ensureHeaderFor: string) {
    if (this.isScenarioAreaByKey(fileKey)) return;
    if (this.nonScenarioPollers.has(fileKey)) return;
    const t = setInterval(() => {
      if (this.closedAreas.has(fileKey)) {
        this.stopNonScenarioPolling(fileKey);
        return;
      }
      this.ensureNonScenarioGroupBullet(fileKey, ensureHeaderFor);
      this.ensureNonScenarioStepsPrinted(fileKey, ensureHeaderFor);
    }, 80);
    this.nonScenarioPollers.set(fileKey, t);
  }

  private stopNonScenarioPolling(fileKey: string) {
    const t = this.nonScenarioPollers.get(fileKey);
    if (t) clearInterval(t);
    this.nonScenarioPollers.delete(fileKey);
  }

  private printDefaultNonScenarioLogIfNeeded(fileKey: string, ensureHeaderFor: string) {
    if (this.isScenarioAreaByKey(fileKey)) return;
    if (this.nonScenarioLogEmitted.has(fileKey)) return;
    const area = this.areas.get(fileKey);
    if (!area) return;
    const stamp = process.env.KNA_LOG_STAMP || '';
    const baseTs = path.basename(area.filePathAbs);
    const baseNoExt = baseTs.replace(/\.ts$/i, '');
    const isSuite = baseNoExt === 'suite.test';
    const scenarioName = isSuite ? 'suite-sentinel' : baseNoExt.replace(/\.test$/i, '');
    const candidate = stamp
      ? buildScenarioLogPath(stamp, scenarioName)
      : path.join('logs', 'latest', 'e2e', `${scenarioName}.log`);
    const absLog = path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
    const url = absLog.replace(/\\/g, '/').replace(/ /g, '%20');
    const line = `- log: file:///${url}`;
    if (this.activeFileKey === fileKey) {
      this.ensureHeader(ensureHeaderFor);
      this.ci.boxLine(line);
    } else {
      const buf = this.buffers.get(fileKey) || { lines: [], hasExplicitLog: false };
      this.buffers.set(fileKey, buf);
      buf.lines.push(line);
    }
    const buf0 = this.buffers.get(fileKey);
    if (buf0) buf0.hasExplicitLog = true;
    this.nonScenarioLogEmitted.add(fileKey);
  }

  private loadScenarioDetail(): any | null {
    const e2eDir = this.getE2EDirForStamp();
    if (!e2eDir) return null;
    const p = path.join(e2eDir, '_scenario-detail.json');
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }

  private listScenarioNamesForArea(areaAbs: string): string[] {
    // If header path was switched to a JSON via AreaFile, fall back to the original test file (if known)
    let sourceAbs = areaAbs;
    if (/\.json$/i.test(areaAbs) || !/\.test\.ts$/i.test(areaAbs)) {
      for (const [, a] of this.areas) {
        if (a.filePathAbs === areaAbs) {
          const metaAny = a as any;
          if (metaAny?.meta?.testFileAbs) sourceAbs = metaAny.meta.testFileAbs;
          break;
        }
      }
    }
    const baseTs = path.basename(sourceAbs);
    const testBase = baseTs.replace(/\.test\.ts$/i, '').replace(/\.ts$/i, '');
    const prefix = testBase + '-';
    const e2eDir = this.getE2EDirForStamp();
    if (!e2eDir || !fs.existsSync(e2eDir)) return [];
    const files = fs
      .readdirSync(e2eDir)
      .filter((f) => f.endsWith('.log') && (f.startsWith(prefix) || f === `${testBase}.log`))
      .sort((a, b) => a.localeCompare(b));
    return files.map((f) => f.replace(/\.log$/i, ''));
  }

  private ensureScenarioStepsPrinted(
    fileKey: string,
    scenarioName: string,
    ensureHeaderFor: string,
  ) {
    // Core steps de-dupe per scenario
    let stepsSet = this.scenarioStepsPrinted.get(fileKey);
    if (!stepsSet) {
      stepsSet = new Set<string>();
      this.scenarioStepsPrinted.set(fileKey, stepsSet);
    }

    const linesToEmit: string[] = [];
    if (!stepsSet.has(scenarioName)) {
      stepsSet.add(scenarioName);
      const detail = this.loadScenarioDetail() || {};
      const steps = detail?.[scenarioName] || {};
      const toIcon = (sev: string | undefined) =>
        sev === 'fail' ? '❌' : sev === 'warn' ? '⚠️' : '✅';
      const toText = (sev: string | undefined, base: string) =>
        sev === 'fail' ? `${base}: Failed` : sev === 'warn' ? `${base}: WARN` : `${base}: OK`;
      linesToEmit.push(
        `- ${toIcon(steps.scaffold?.severity)} ${toText(steps.scaffold?.severity, 'scaffold')}`,
      );
      linesToEmit.push(
        `- ${toIcon(steps.env?.severity)} ${toText(steps.env?.severity, 'env manifest checks')}`,
      );
      linesToEmit.push(
        `- ${toIcon(steps.files?.severity)} ${toText(steps.files?.severity, 'files manifest checks')}`,
      );
    }

    // Handle mergeEnv skip separately to allow late config detection
    try {
      const area = this.areas.get(fileKey);
      let cfgPath = (area as any)?.meta?.configPath as string | undefined;
      if (!cfgPath || !fs.existsSync(cfgPath)) {
        const testAbs: string | undefined = (area as any)?.meta?.testFileAbs ?? area?.filePathAbs;
        if (testAbs) {
          const dir = path.dirname(testAbs);
          const candidate = path.join(dir, 'config', 'tests.json');
          if (fs.existsSync(candidate)) cfgPath = candidate;
        }
      }
      if (cfgPath && fs.existsSync(cfgPath)) {
        const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const arr = Array.isArray(raw?.scenarios) ? raw.scenarios : [];
        const found = arr.find((x: any) => x?.scenarioName === scenarioName);
        if (found?.tests?.mergeEnv?.env) {
          let skipSet = this.scenarioSkipPrinted.get(fileKey);
          if (!skipSet) {
            skipSet = new Set<string>();
            this.scenarioSkipPrinted.set(fileKey, skipSet);
          }
          if (!skipSet.has(scenarioName)) {
            linesToEmit.push(`- ↩️ mergeEnv: skipped (not implemented)`);
            skipSet.add(scenarioName);
          }
        }
      }
    } catch {
      /* ignore */
    }

    if (!linesToEmit.length) return;
    if (this.activeFileKey === fileKey) {
      this.ensureHeader(ensureHeaderFor);
      for (const l of linesToEmit) this.ci.boxLine(l);
    } else {
      const buf = this.buffers.get(fileKey) || { lines: [], hasExplicitLog: false };
      this.buffers.set(fileKey, buf);
      buf.lines.push(...linesToEmit);
    }
  }

  private debugEnabled(): boolean {
    return process.env.KNA_DEBUG_REPORTER === '1';
  }

  private noteFirst(filePath: string, source: 'console' | 'task', snippet: string) {
    const key = this.toKey(filePath);
    if (this.firstEventByFile.has(key)) return;
    this.firstEventByFile.set(key, { when: Date.now() - this.runStartMs, source, snippet });
  }

  private toKey(p: string): string {
    return path.resolve(p).replace(/\\/g, '/').toLowerCase();
  }

  // Load mapping of test title (it) -> scenarioName from the area config tests.json
  private loadScenarioItToNameMap(fileKey: string): Map<string, string> | null {
    try {
      const area = this.areas.get(fileKey) as any;
      let cfgPath: string | undefined = area?.meta?.configPath;
      if (!cfgPath || !fs.existsSync(cfgPath)) {
        // Fallback: derive config path from the test file location: <scenarioDir>/config/tests.json
        const testAbs: string | undefined = (area as any)?.meta?.testFileAbs ?? area?.filePathAbs;
        if (testAbs) {
          const dir = path.dirname(testAbs);
          const defaultCandidate = path.join(dir, 'config', 'tests.json');
          const pre = getPreReleaseVersion() || '';
          const preCandidate = pre
            ? path.join(dir, 'pre-release-tests', pre, 'config', 'tests.json')
            : null;
          // Prefer pre-release config when present
          if (preCandidate && fs.existsSync(preCandidate)) cfgPath = preCandidate;
          else if (fs.existsSync(defaultCandidate)) cfgPath = defaultCandidate;
        }
      }
      if (!cfgPath || !fs.existsSync(cfgPath)) return null;
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as any;
      const arr: any[] = Array.isArray(raw?.scenarios) ? raw.scenarios : [];
      const map = new Map<string, string>();
      for (const entry of arr) {
        const title: string | undefined = entry?.it ?? entry?.scenarioName;
        const scen: string | undefined = entry?.scenarioName ?? entry?.it;
        if (title && scen) map.set(String(title), String(scen));
      }
      return map;
    } catch {
      return null;
    }
  }

  private isScenarioAreaByKey(fileKey: string): boolean {
    const area = this.areas.get(fileKey);
    const abs = ((area as any)?.meta?.testFileAbs ?? area?.filePathAbs ?? '').replace(/\\/g, '/');
    return /test\/e2e\/scenarios\/(?!_runner\/).+\/.+\.test\.ts$/i.test(abs);
  }

  private getAreaName(fileName: string): string {
    if (fileName === 'suite.test') return 'Suite tests';
    if (fileName === 'prompt-map.schema.test') return 'Schema tests';
    if (fileName.includes('local-only')) return 'Scenario tests';
    if (fileName.includes('scenarios')) return 'Scenario tests';
    return fileName;
  }

  private getOrCreateArea(filePath: string) {
    const key = this.toKey(filePath);
    let area = this.areas.get(key);
    if (!area) {
      const fileName = path.basename(filePath, '.ts');
      area = {
        name: this.getAreaName(fileName),
        filePathAbs: path.resolve(filePath),
        counts: {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          warning: 0,
        },
        meta: { totalTests: 0, finishedTests: 0 },
      };
      // Track original test file path for later lookups (e.g., scenario name discovery)
      (area as any).meta.testFileAbs = path.resolve(filePath);
      this.areas.set(key, area);
      if (!this.buffers.has(key)) this.buffers.set(key, { lines: [], hasExplicitLog: false });
    }
    return area;
  }

  private ensureHeader(filePath: string) {
    const key = this.toKey(filePath);
    if (this.headerStarted.has(key)) return;
    if (this.activeFileKey !== key) return; // only active area can print its header
    const area = this.getOrCreateArea(filePath);
    this.ci.boxStart(area.name);
    const absHeaderPath = area.filePathAbs;
    const urlPath = absHeaderPath.replace(/\\/g, '/').replace(/ /g, '%20');
    this.ci.boxLine(`file:///${urlPath}`);
    // For Scenario areas, print the config tests.json URL right under the header
    if (this.isScenarioAreaByKey(key)) {
      const cfg = this.getConfigPathForArea(key);
      if (cfg && fs.existsSync(cfg)) {
        const cfgUrl = cfg.replace(/\\/g, '/').replace(/ /g, '%20');
        this.ci.boxLine(`file:///${cfgUrl}`);
      }
    }
    this.headerStarted.add(key);
    // Flush any buffered lines now that header is printed
    const buf0 = this.buffers.get(key);
    if (buf0 && buf0.lines.length) {
      for (const l of buf0.lines) this.ci.boxLine(l);
      buf0.lines.length = 0;
    }
  }

  // Resolve config path for a scenario area (prefer pre-release config when set)
  private getConfigPathForArea(fileKey: string): string | null {
    try {
      const area = this.areas.get(fileKey) as any;
      let cfgPath: string | undefined = area?.meta?.configPath;
      if (!cfgPath || !fs.existsSync(cfgPath)) {
        const testAbs: string | undefined = (area as any)?.meta?.testFileAbs ?? area?.filePathAbs;
        if (testAbs) {
          const dir = path.dirname(testAbs);
          const pre = getPreReleaseVersion() || '';
          const preCandidate = pre
            ? path.join(dir, 'pre-release-tests', pre, 'config', 'tests.json')
            : null;
          const defaultCandidate = path.join(dir, 'config', 'tests.json');
          if (preCandidate && fs.existsSync(preCandidate)) cfgPath = preCandidate;
          else if (fs.existsSync(defaultCandidate)) cfgPath = defaultCandidate;
        }
      }
      return cfgPath ? path.resolve(cfgPath) : null;
    } catch {
      return null;
    }
  }

  private switchArea(filePath: string) {
    const key = this.toKey(filePath);
    this.currentAreaKey = key;
    this.activeFileKey = key;
    this.ensureHeader(filePath);
    // Inject non-scenario group bullet and start polling JSON steps
    this.ensureNonScenarioGroupBullet(key, filePath);
    this.startNonScenarioPolling(key, filePath);
    // Flush any buffered lines for this area immediately upon activation
    const buf = this.buffers.get(key);
    if (buf && buf.lines.length) {
      for (const l of buf.lines) this.ci.boxLine(l);
      buf.lines.length = 0;
    }
  }

  private headOfQueue(): string | null {
    for (const p of this.fileQueue) {
      if (!this.closedAreas.has(p)) return p;
    }
    return null;
  }

  // Find the next file in the original queue order that hasn't been closed yet
  private nextInQueue(currentKey: string): string | null {
    const idx = this.fileQueue.findIndex((k) => k === currentKey);
    for (let i = idx + 1; i < this.fileQueue.length; i++) {
      const k = this.fileQueue[i];
      if (!this.closedAreas.has(k)) return k;
    }
    return null;
  }

  private ensureInQueue(filePath: string) {
    const key = this.toKey(filePath);
    if (!this.areas.has(key)) this.getOrCreateArea(filePath);
    if (!this.fileQueue.includes(key)) this.fileQueue.push(key);
  }

  private maybeActivate(filePath: string) {
    const key = this.toKey(filePath);
    this.startedFiles.add(key);
    const head = this.headOfQueue();
    if (!head) return;
    if (this.activeFileKey) return; // already streaming an area
    // If the current head is Schema but Suite hasn't been collected yet, wait
    const suiteExists = Array.from(this.areas.keys()).some((k) => this.isSuiteAreaByKey(k));
    if (!suiteExists && this.isSchemaRunnerAreaByKey(head)) {
      return;
    }
    // Prefer Suite as the first active area if it exists and is pending
    const suiteKey = this.fileQueue.find(
      (k) => !this.closedAreas.has(k) && this.isSuiteAreaByKey(k),
    );
    const desiredHead = suiteKey || head;
    if (key === desiredHead) {
      this.switchArea(filePath);
      // Once we activate the first area, freeze the queue ordering
      this.queueFinalized = true;
    }
  }

  private closeArea(filePath: string) {
    const key = this.toKey(filePath);
    if (this.closedAreas.has(key)) return;
    const area = this.areas.get(key);
    if (!area) return;
    // Stop any JSON polling for this area
    this.stopNonScenarioPolling(key);
    // Ensure header is printed
    this.ensureHeader(filePath);
    // Flush any pending buffered lines for this file in order; we'll only add a default log
    // if no explicit log line has ever been observed.
    const buf = this.buffers.get(key);
    const hadExplicitLog = !!buf?.hasExplicitLog; // remember if any explicit log was ever seen (even if already printed)
    let sawExplicitInFlush = false;
    if (buf) {
      for (const l of buf.lines) {
        if (/^-.+log:\s+/i.test(l)) sawExplicitInFlush = true;
        this.ci.boxLine(l);
      }
      buf.lines.length = 0;
      // Preserve cumulative explicit flag so we don't add a default if one was already emitted live
      buf.hasExplicitLog = hadExplicitLog || sawExplicitInFlush;
    }
    // Flush any deferred scenario-specific logs first (ensures they appear even if summary didn't)
    const scenMap = this.scenarioLogsByFile.get(key);
    if (scenMap && scenMap.size) {
      for (const [, line] of scenMap) {
        this.ci.boxLine(line);
        sawExplicitInFlush = true;
      }
      scenMap.clear();
    }
    // Flush any remaining generic deferred logs for this file
    const genQ = this.deferredLogsByFile.get(key);
    if (genQ && genQ.length) {
      for (const l of genQ) {
        this.ci.boxLine(l);
      }
      genQ.length = 0;
      sawExplicitInFlush = true;
    }
    // If we never saw an explicit log for this area at all, add a default now
    if (!(hadExplicitLog || sawExplicitInFlush)) {
      // No explicit log saw at all: emit discovered scenario logs (preferred) or a sensible default
      const stamp = process.env.KNA_LOG_STAMP || '';
      const absHeader = area.filePathAbs.replace(/\\/g, '/');
      const isScenarioArea = /\/test\/e2e\/scenarios\//i.test(absHeader);
      if (isScenarioArea && stamp) {
        const e2eDir = path.resolve('logs', stamp, 'e2e');
        const baseTs = path.basename(absHeader);
        const testBase = baseTs.replace(/\.test\.ts$/i, '').replace(/\.ts$/i, '');
        const prefix = testBase + '-';
        if (fs.existsSync(e2eDir)) {
          const files = fs
            .readdirSync(e2eDir)
            .filter((f) => f.endsWith('.log') && (f.startsWith(prefix) || f === `${testBase}.log`))
            .sort((a, b) => a.localeCompare(b));
          if (files.length) {
            for (const f of files) {
              const absLog = path.resolve(e2eDir, f).replace(/\\/g, '/').replace(/ /g, '%20');
              this.ci.boxLine(`- log: file:///${absLog}`);
            }
          } else {
            // fallback single
            const absLog = path
              .resolve('logs', stamp, 'e2e', `${testBase}.log`)
              .replace(/\\/g, '/')
              .replace(/ /g, '%20');
            this.ci.boxLine(`- log: file:///${absLog}`);
          }
        } else {
          // e2e dir missing; fallback single
          const absLog = path
            .resolve('logs', stamp, 'e2e', `${testBase}.log`)
            .replace(/\\/g, '/')
            .replace(/ /g, '%20');
          this.ci.boxLine(`- log: file:///${absLog}`);
        }
      } else {
        const baseTs = path.basename(area.filePathAbs);
        const baseNoExt = baseTs.replace(/\.ts$/i, '');
        const isSuite = baseNoExt === 'suite.test';
        const scenarioName = baseNoExt.replace(/\.test$/i, '');
        // Prefer the suite sentinel log for Suite tests for consistency with other areas
        const candidate = isSuite
          ? stamp
            ? buildScenarioLogPath(stamp, 'suite-sentinel')
            : path.join('logs', 'latest', 'e2e', 'suite-sentinel.log')
          : stamp
            ? buildScenarioLogPath(stamp, scenarioName)
            : path.join('logs', 'latest', 'e2e', `${scenarioName}.log`);
        const absLog = path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
        const url = absLog.replace(/\\/g, '/').replace(/ /g, '%20');
        this.ci.boxLine(`- log: file:///${url}`);
      }
    }
    // Treat only real scenario test files as scenario areas (exclude _runner schema)
    if (this.isScenarioAreaByKey(key)) {
      const scenNames = this.listScenarioNamesForArea(area.filePathAbs);
      const detail = this.loadScenarioDetail() || {};
      let passed = 0,
        failed = 0,
        warn = 0,
        skipped = 0;
      for (const s of scenNames) {
        const d = detail?.[s] || {};
        const sev = (k: string) => (d?.[k]?.severity as string | undefined) ?? undefined;
        const add = (kk: string) => {
          const v = sev(kk);
          if (v === 'fail') failed += 1;
          else if (v === 'warn') warn += 1;
          else passed += 1;
        };
        add('scaffold');
        add('env');
        add('files');
      }
      // mergeEnv skips from config
      try {
        let cfgPath = (area as any)?.meta?.configPath as string | undefined;
        if (!cfgPath || !fs.existsSync(cfgPath)) {
          const testAbs: string | undefined = (area as any)?.meta?.testFileAbs ?? area.filePathAbs;
          if (testAbs) {
            const dir = path.dirname(testAbs);
            const candidate = path.join(dir, 'config', 'tests.json');
            if (fs.existsSync(candidate)) cfgPath = candidate;
          }
        }
        if (cfgPath && fs.existsSync(cfgPath)) {
          const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
          const arr = Array.isArray(raw?.scenarios) ? raw.scenarios : [];
          for (const s of scenNames) {
            const found = arr.find((x: any) => x?.scenarioName === s);
            if (found?.tests?.mergeEnv?.env) skipped += 1;
          }
        }
      } catch {
        /* ignore */
      }
      const groups = scenNames.length || area.counts.total;
      this.ci.boxEnd(
        `(Test Groups: ${groups}, passed: ${passed}, failed: ${failed}, warning: ${warn}, skipped: ${skipped})`,
      );
    } else {
      // Non-scenario areas (Suite/Schema): compute counts from JSON steps
      const steps = this.loadNonScenarioSteps(key);
      let passed = 0,
        failed = 0,
        warn = 0,
        skipped = 0;
      for (const s of steps) {
        if (s.severity === 'fail') failed += 1;
        else if (s.severity === 'warn') warn += 1;
        else if (s.severity === 'skip') skipped += 1;
        else passed += 1;
      }
      this.ci.boxEnd(
        `(Tests: ${steps.length}, passed: ${passed}, failed: ${failed}, warning: ${warn}, skipped: ${skipped})`,
      );
    }
    this.closedAreas.add(key);
    // Do not advance here; onTestSuiteFinished/onFinished will progress in order
  }

  // Schedule a debounced close, allowing late console logs to be captured
  private scheduleClose(filePath: string) {
    const key = this.toKey(filePath);
    const prev = this.closeTimers.get(key);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.performClose(filePath);
    }, this.CLOSE_DELAY_MS);
    this.closeTimers.set(key, t);
  }

  // Perform area close and advance in original queue order
  private performClose(filePath: string) {
    const key = this.toKey(filePath);
    const head = this.headOfQueue();
    if (this.closedAreas.has(key)) return;
    const area = this.areas.get(key);
    if (!area) return;

    // Ensure activation for proper header printing when closing the head or when already active
    if (this.activeFileKey === key || (!this.activeFileKey && head === key)) {
      if (!this.activeFileKey) this.switchArea(area.filePathAbs);
      this.closeArea(area.filePathAbs);
      // Advance to the next file in original queue order
      while (true) {
        const next = this.nextInQueue(key);
        if (!next) break;
        if (this.closedAreas.has(next)) {
          continue;
        }
        const nextArea = this.areas.get(next);
        if (!nextArea) break;
        if (
          this.finished.has(next) ||
          (nextArea.meta.finishedTests >= nextArea.meta.totalTests && nextArea.meta.totalTests > 0)
        ) {
          this.switchArea(nextArea.filePathAbs);
          this.closeArea(nextArea.filePathAbs);
          continue;
        } else {
          this.switchArea(nextArea.filePathAbs);
          break;
        }
      }
      this.activeFileKey = null;
      this.currentAreaKey = null;
    }

    const prev = this.closeTimers.get(key);
    if (prev) clearTimeout(prev);
    this.closeTimers.delete(key);
  }

  onInit(): void {
    this.ci.write('🧪 Running tests...');
  }

  onCollected(files: RunnerTestFile[]): void {
    // Index tasks for all files in this collection batch
    const batchFiles = new Set<string>();
    for (const file of files) {
      const filePath = file.filepath || file.name || '';
      if (!filePath) continue;
      batchFiles.add(filePath);
      const area = this.getOrCreateArea(filePath);
      this.buffers.get(this.toKey(filePath))!; // ensure buffer exists

      const walk = (tasks: RunnerTask[] | undefined) => {
        if (!tasks) return;
        for (const t of tasks) {
          const anyT = t as any;
          if (anyT?.id) this.taskById.set(anyT.id, t);
          if (t.type === 'test') {
            area.meta.totalTests += 1;
          }
          const children: RunnerTask[] | undefined = (anyT?.tasks as RunnerTask[]) || undefined;
          if (children?.length) walk(children);
        }
      };
      walk(file.tasks as unknown as RunnerTask[]);
    }

    // Merge batch into collected set
    for (const p of batchFiles) this.collectedKeys.add(this.toKey(p));

    // If queue not finalized (no area activated yet), rebuild full deterministic queue
    if (!this.queueFinalized) {
      const toPosix = (p: string) => p.replace(/\\/g, '/');
      const keyToAbs = (k: string) => this.areas.get(k)?.filePathAbs ?? k;
      const isSuite = (abs: string) => /test\/e2e\/suite\.test\.ts$/i.test(toPosix(abs));
      const isSchema = (abs: string) =>
        /test\/e2e\/schema\/prompt-map\.schema\.test\.ts$/i.test(toPosix(abs));
      const isScenario = (abs: string) =>
        /test\/e2e\/scenarios\/.+\/.+\.test\.ts$/i.test(toPosix(abs));

      const allKeys = Array.from(this.collectedKeys);
      const rank = (k: string) => {
        const abs = keyToAbs(k);
        if (isSuite(abs)) return 0;
        if (isSchema(abs)) return 1;
        if (isScenario(abs)) return 2;
        return 3;
      };
      // Unique keys already from Set; sort by rank then by path for stability
      this.fileQueue = allKeys.sort((a, b) => {
        const ra = rank(a),
          rb = rank(b);
        if (ra !== rb) return ra - rb;
        return toPosix(keyToAbs(a)).localeCompare(toPosix(keyToAbs(b)));
      });

      // Activate Suite immediately when present to ensure deterministic Suite → Schema → Scenarios order
      const headKey = this.fileQueue[0];
      if (headKey) {
        const headAbs = keyToAbs(headKey);
        if (isSuite(headAbs)) this.switchArea(headAbs);
      }

      if (this.debugEnabled() && !this.plannedOrderPrinted) {
        const label = 'Reporter debug: planned file order';
        this.ci.boxStart(label);
        for (const k of this.fileQueue) {
          const a = this.areas.get(k);
          if (!a) continue;
          this.ci.boxLine(`${a.name} — ${a.filePathAbs}`);
        }
        this.ci.boxEnd('end planned order');
        this.ci.write('');
        this.plannedOrderPrinted = true;
      }

      // Do not proactively activate; wait for first event to trigger header for the head-of-queue area
    }
  }

  // Vitest v3 emits task result updates through onTaskUpdate(packs)
  // Each pack typically contains [taskId, result]
  // We'll look up the task, ensure its area is active, and print a single line per final state.
  onTaskUpdate(packs: any[]): void {
    if (!Array.isArray(packs)) return;
    for (const pack of packs) {
      // Support both tuple form [id, result] and object form { id, result }
      const id = Array.isArray(pack) ? pack[0] : pack?.id;
      const result = Array.isArray(pack) ? pack[1] : pack?.result;
      if (!id) continue;

      const task = this.taskById.get(String(id)) as any as RunnerTask | undefined;
      if (!task) continue;
      if ((task as any).type !== 'test') continue; // only print actual tests

      // Avoid reprinting terminal states; allow 'run'/'running' to emit bullet
      const alreadyPrinted = this.printedTests.has(String(id));

      const state: string | undefined = (result?.state ?? (task as any)?.result?.state) as any;
      if (!state) continue;

      // We'll handle terminal states later; for now allow non-terminal to proceed to compute context
      if (
        state !== 'pass' &&
        state !== 'fail' &&
        state !== 'skip' &&
        state !== 'run' &&
        state !== 'running'
      )
        continue;

      const filePath = (task as any)?.file?.filepath || (task as any)?.file?.name || '';
      if (!filePath) continue;
      const key = this.toKey(filePath);
      this.ensureInQueue(filePath);
      const area = this.areas.get(key);
      const buf = this.buffers.get(key) || { lines: [], hasExplicitLog: false };
      this.buffers.set(key, buf);

      // Mark start and activate if this is the head-of-queue
      this.maybeActivate(filePath);

      // Early bullet on start of test to align with runner
      if ((state === 'run' || state === 'running') && !alreadyPrinted) {
        const isScenarioArea = this.isScenarioAreaByKey(key);
        if (isScenarioArea) {
          const scenMap = this.loadScenarioItToNameMap(key);
          const scenLabel = scenMap?.get(task.name || '') ?? (task.name || '(anonymous test)');
          let set = this.bulletsByFile.get(key);
          if (!set) {
            set = new Set<string>();
            this.bulletsByFile.set(key, set);
          }
          if (!set.has(task.name || '')) {
            set.add(task.name || '');
            const bullet = `• Testing ${scenLabel}...`;
            if (this.activeFileKey === key) {
              this.ensureHeader(filePath);
              this.ci.boxLine(bullet);
            } else buf.lines.push(bullet);
            // Record last scenario for this file to help map summaries/logs
            this.lastScenarioByFile.set(key, scenLabel);
          }
        }
        continue;
      }

      if (state !== 'pass' && state !== 'fail' && state !== 'skip') continue;

      const name = task.name || '(anonymous test)';
      const duration: number | undefined = (result?.duration ??
        (task as any)?.result?.duration) as any;
      const durationText = duration != null ? ` (${duration}ms)` : '';

      if (this.debugEnabled()) {
        this.noteFirst(filePath, 'task', name);
      }

      // Do not change active area based on events; header/printing is ordered by fileQueue

      const isScenarioArea = this.isScenarioAreaByKey(key);

      // Inject a per-test bullet only for Scenario areas
      const ensureBullet = () => {
        if (!isScenarioArea) return [] as string[];
        let set = this.bulletsByFile.get(key);
        if (!set) {
          set = new Set<string>();
          this.bulletsByFile.set(key, set);
        }
        if (set.has(name)) return [] as string[];
        set.add(name);
        const scenMap = this.loadScenarioItToNameMap(key);
        const scenLabel = scenMap?.get(name) ?? name;
        return [`• Testing ${scenLabel}...`];
      };

      const hasDuration = duration != null;

      // Only print summaries once we have a duration so we avoid duplicate prints
      if (!hasDuration) {
        continue;
      }

      const statusTag = {
        pass: '[OK]',
        fail: '[Failed]',
        skip: '[Skipped]',
      } as const;

      if (state === 'pass') {
        if (this.activeFileKey === key) {
          this.ensureHeader(filePath);
          // Ensure non-scenario bullets/steps appear before the summary
          if (!this.isScenarioAreaByKey(key)) {
            this.ensureNonScenarioGroupBullet(key, filePath);
            this.ensureNonScenarioStepsPrinted(key, filePath);
          }
          // print bullet(s) then the test line
          for (const l of ensureBullet()) this.ci.boxLine(l);
          // If we saw a scenario bullet earlier, print its step lines before the summary
          const scenMap = this.loadScenarioItToNameMap(key);
          const scenResolved = scenMap?.get(name) ?? this.lastScenarioByFile.get(key);
          if (scenResolved) this.ensureScenarioStepsPrinted(key, scenResolved, filePath);
          // Non-scenario step lines come from JSON polling; scenarios via scenario detail
          this.ci.boxLine(`- ${name} ${statusTag.pass}${durationText}`);
          this.lastPrintedTestTitleByFile.set(key, name);
          // For non-scenario areas, ensure a log link is present immediately
          if (!this.isScenarioAreaByKey(key)) {
            this.printDefaultNonScenarioLogIfNeeded(key, filePath);
          }
          // After summary, emit log link immediately for scenario tests
          const isScenarioArea2 = this.isScenarioAreaByKey(key);
          if (isScenarioArea2) {
            if (scenResolved) {
              const stamp = process.env.KNA_LOG_STAMP || '';
              const candidate = stamp
                ? buildScenarioLogPath(stamp, scenResolved)
                : path.join('logs', 'latest', 'e2e', `${scenResolved}.log`);
              const absLog = path.resolve(candidate).replace(/\\/g, '/').replace(/ /g, '%20');
              const line = `- log: file:///${absLog}`;
              let seen = this.printedLogLinesByFile.get(key);
              if (!seen) {
                seen = new Set<string>();
                this.printedLogLinesByFile.set(key, seen);
              }
              if (!seen.has(line)) {
                this.ci.boxLine(line);
                seen.add(line);
                const bufX = this.buffers.get(key);
                if (bufX) bufX.hasExplicitLog = true;
              }
              // remove any deferred duplicates
              const sm = this.scenarioLogsByFile.get(key);
              if (sm) {
                sm.delete(name);
                sm.delete(scenResolved);
              }
            }
          } else {
            // Non-scenario: fallback to any deferred log now
            const sm = this.scenarioLogsByFile.get(key);
            const ln = sm?.get(name);
            if (ln) {
              this.ci.boxLine(ln);
              sm!.delete(name);
            }
          }
          // Then any generic logs queued for this file
          const q = this.deferredLogsByFile.get(key);
          if (q && q.length) {
            for (const l of q) this.ci.boxLine(l);
            q.length = 0;
          }
        } else {
          // Ensure non-scenario bullets/steps are buffered before summary
          if (!this.isScenarioAreaByKey(key)) {
            this.ensureNonScenarioGroupBullet(key, filePath);
            this.ensureNonScenarioStepsPrinted(key, filePath);
          }
          const lines = [...ensureBullet()];
          const scenMap = this.loadScenarioItToNameMap(key);
          const scenResolved = scenMap?.get(name) ?? this.lastScenarioByFile.get(key);
          if (scenResolved) {
            // inject step lines into buffer before summary
            this.ensureScenarioStepsPrinted(key, scenResolved, filePath);
          }
          // Non-scenario steps come from JSON; scenario steps handled above
          lines.push(`- ${name} ${statusTag.pass}${durationText}`);
          this.lastPrintedTestTitleByFile.set(key, name);
          if (!this.isScenarioAreaByKey(key)) {
            // Ensure a log link is included in the buffer immediately
            this.printDefaultNonScenarioLogIfNeeded(key, filePath);
          }
          // After summary, emit log link immediately for scenario tests (buffered)
          const isScenarioArea2 = this.isScenarioAreaByKey(key);
          if (isScenarioArea2 && scenResolved) {
            const stamp = process.env.KNA_LOG_STAMP || '';
            const candidate = stamp
              ? buildScenarioLogPath(stamp, scenResolved)
              : path.join('logs', 'latest', 'e2e', `${scenResolved}.log`);
            const absLog = path.resolve(candidate).replace(/\\/g, '/').replace(/ /g, '%20');
            const line = `- log: file:///${absLog}`;
            let seen = this.printedLogLinesByFile.get(key);
            if (!seen) {
              seen = new Set<string>();
              this.printedLogLinesByFile.set(key, seen);
            }
            if (!seen.has(line)) {
              lines.push(line);
              seen.add(line);
              const bufX = this.buffers.get(key);
              if (bufX) bufX.hasExplicitLog = true;
            }
            const sm = this.scenarioLogsByFile.get(key);
            if (sm) {
              sm.delete(name);
              sm.delete(scenResolved);
            }
          } else {
            // Non-scenario: append any deferred logs now that summary is buffered
            const sm = this.scenarioLogsByFile.get(key);
            const ln = sm?.get(name) ?? (scenResolved ? sm?.get(scenResolved) : undefined);
            if (ln) {
              lines.push(ln);
              sm!.delete(name);
              if (scenResolved) sm!.delete(scenResolved);
            }
          }
          // Generic logs
          const q = this.deferredLogsByFile.get(key);
          if (q && q.length) {
            lines.push(...q);
            q.length = 0;
          }
          buf.lines.push(...lines);
        }
        // Count only scenario tests toward scenario footer totals
        if (area && this.isScenarioAreaByKey(key)) {
          area.counts.total += 1;
          area.counts.passed += 1;
        }
      } else if (state === 'fail') {
        if (this.activeFileKey === key) {
          this.ensureHeader(filePath);
          if (!this.isScenarioAreaByKey(key)) {
            this.ensureNonScenarioGroupBullet(key, filePath);
            this.ensureNonScenarioStepsPrinted(key, filePath);
          }
          for (const l of ensureBullet()) this.ci.boxLine(l);
          const scenMap = this.loadScenarioItToNameMap(key);
          const scenResolved = scenMap?.get(name) ?? this.lastScenarioByFile.get(key);
          if (scenResolved) this.ensureScenarioStepsPrinted(key, scenResolved, filePath);
          // Non-scenario steps come from JSON
          this.ci.boxLine(`- ${name} ${statusTag.fail}${durationText}`);
          this.lastPrintedTestTitleByFile.set(key, name);
          if (!this.isScenarioAreaByKey(key)) {
            this.printDefaultNonScenarioLogIfNeeded(key, filePath);
          }
          // After summary, prefer immediate log link for scenario tests
          const isScenarioArea2 = this.isScenarioAreaByKey(key);
          if (isScenarioArea2 && scenResolved) {
            const stamp = process.env.KNA_LOG_STAMP || '';
            const candidate = stamp
              ? buildScenarioLogPath(stamp, scenResolved)
              : path.join('logs', 'latest', 'e2e', `${scenResolved}.log`);
            const absLog = path.resolve(candidate).replace(/\\/g, '/').replace(/ /g, '%20');
            const line = `- log: file:///${absLog}`;
            let seen = this.printedLogLinesByFile.get(key);
            if (!seen) {
              seen = new Set<string>();
              this.printedLogLinesByFile.set(key, seen);
            }
            if (!seen.has(line)) {
              this.ci.boxLine(line);
              seen.add(line);
              const bufX = this.buffers.get(key);
              if (bufX) bufX.hasExplicitLog = true;
            }
            const sm = this.scenarioLogsByFile.get(key);
            if (sm) {
              sm.delete(name);
              sm.delete(scenResolved);
            }
          } else {
            const sm = this.scenarioLogsByFile.get(key);
            const ln = sm?.get(name) ?? (scenResolved ? sm?.get(scenResolved) : undefined);
            if (ln) {
              this.ci.boxLine(ln);
              sm!.delete(name);
              if (scenResolved) sm!.delete(scenResolved);
            }
          }
          const q = this.deferredLogsByFile.get(key);
          if (q && q.length) {
            for (const l of q) this.ci.boxLine(l);
            q.length = 0;
          }
        } else {
          if (!this.isScenarioAreaByKey(key)) {
            this.ensureNonScenarioGroupBullet(key, filePath);
            this.ensureNonScenarioStepsPrinted(key, filePath);
          }
          const lines = [...ensureBullet()];
          const scenMap = this.loadScenarioItToNameMap(key);
          const scenResolved = scenMap?.get(name) ?? this.lastScenarioByFile.get(key);
          if (scenResolved) this.ensureScenarioStepsPrinted(key, scenResolved, filePath);
          // Non-scenario steps come from JSON
          lines.push(`- ${name} ${statusTag.fail}${durationText}`);
          this.lastPrintedTestTitleByFile.set(key, name);
          if (!this.isScenarioAreaByKey(key)) {
            this.printDefaultNonScenarioLogIfNeeded(key, filePath);
          }
          const isScenarioArea2 = this.isScenarioAreaByKey(key);
          if (isScenarioArea2 && scenResolved) {
            const stamp = process.env.KNA_LOG_STAMP || '';
            const candidate = stamp
              ? buildScenarioLogPath(stamp, scenResolved)
              : path.join('logs', 'latest', 'e2e', `${scenResolved}.log`);
            const absLog = path.resolve(candidate).replace(/\\/g, '/').replace(/ /g, '%20');
            const line = `- log: file:///${absLog}`;
            let seen = this.printedLogLinesByFile.get(key);
            if (!seen) {
              seen = new Set<string>();
              this.printedLogLinesByFile.set(key, seen);
            }
            if (!seen.has(line)) {
              lines.push(line);
              seen.add(line);
              const bufX = this.buffers.get(key);
              if (bufX) bufX.hasExplicitLog = true;
            }
            const sm = this.scenarioLogsByFile.get(key);
            if (sm) {
              sm.delete(name);
              sm.delete(scenResolved);
            }
          } else {
            const sm = this.scenarioLogsByFile.get(key);
            const ln = sm?.get(name) ?? (scenResolved ? sm?.get(scenResolved) : undefined);
            if (ln) {
              lines.push(ln);
              sm!.delete(name);
              if (scenResolved) sm!.delete(scenResolved);
            }
          }
          const q = this.deferredLogsByFile.get(key);
          if (q && q.length) {
            lines.push(...q);
            q.length = 0;
          }
          buf.lines.push(...lines);
        }
        if (area && this.isScenarioAreaByKey(key)) {
          area.counts.total += 1;
          area.counts.failed += 1;
        }
      } else if (state === 'skip') {
        if (this.activeFileKey === key) {
          this.ensureHeader(filePath);
          if (!this.isScenarioAreaByKey(key)) {
            this.ensureNonScenarioGroupBullet(key, filePath);
            this.ensureNonScenarioStepsPrinted(key, filePath);
          }
          for (const l of ensureBullet()) this.ci.boxLine(l);
          const scenMap = this.loadScenarioItToNameMap(key);
          const scenResolved = scenMap?.get(name) ?? this.lastScenarioByFile.get(key);
          if (scenResolved) this.ensureScenarioStepsPrinted(key, scenResolved, filePath);
          // Non-scenario steps come from JSON
          this.ci.boxLine(`- ${name} ${statusTag.skip}${durationText}`);
          this.lastPrintedTestTitleByFile.set(key, name);
          if (!this.isScenarioAreaByKey(key)) {
            this.printDefaultNonScenarioLogIfNeeded(key, filePath);
          }
          const absHeaderPath = this.areas.get(key)?.filePathAbs ?? filePath;
          const isScenarioArea = /[\\/]test[\\/]e2e[\\/]scenarios[\\/]/i.test(absHeaderPath);
          if (isScenarioArea && scenResolved) {
            const stamp = process.env.KNA_LOG_STAMP || '';
            const candidate = stamp
              ? buildScenarioLogPath(stamp, scenResolved)
              : path.join('logs', 'latest', 'e2e', `${scenResolved}.log`);
            const absLog = path.resolve(candidate).replace(/\\/g, '/').replace(/ /g, '%20');
            const line = `- log: file:///${absLog}`;
            let seen = this.printedLogLinesByFile.get(key);
            if (!seen) {
              seen = new Set<string>();
              this.printedLogLinesByFile.set(key, seen);
            }
            if (!seen.has(line)) {
              this.ci.boxLine(line);
              seen.add(line);
              const bufX = this.buffers.get(key);
              if (bufX) bufX.hasExplicitLog = true;
            }
            const sm = this.scenarioLogsByFile.get(key);
            if (sm) {
              sm.delete(name);
              sm.delete(scenResolved);
            }
          } else {
            const sm = this.scenarioLogsByFile.get(key);
            const ln = sm?.get(name) ?? (scenResolved ? sm?.get(scenResolved) : undefined);
            if (ln) {
              this.ci.boxLine(ln);
              sm!.delete(name);
              if (scenResolved) sm!.delete(scenResolved);
            }
          }
          const q = this.deferredLogsByFile.get(key);
          if (q && q.length) {
            for (const l of q) this.ci.boxLine(l);
            q.length = 0;
          }
        } else {
          if (!this.isScenarioAreaByKey(key)) {
            this.ensureNonScenarioGroupBullet(key, filePath);
            this.ensureNonScenarioStepsPrinted(key, filePath);
          }
          const lines = [...ensureBullet()];
          const scenMap = this.loadScenarioItToNameMap(key);
          const scenResolved = scenMap?.get(name) ?? this.lastScenarioByFile.get(key);
          if (scenResolved) this.ensureScenarioStepsPrinted(key, scenResolved, filePath);
          // Non-scenario steps come from JSON
          lines.push(`- ${name} ${statusTag.skip}${durationText}`);
          this.lastPrintedTestTitleByFile.set(key, name);
          if (!this.isScenarioAreaByKey(key)) {
            this.printDefaultNonScenarioLogIfNeeded(key, filePath);
          }
          const absHeaderPath = this.areas.get(key)?.filePathAbs ?? filePath;
          const isScenarioArea = /[\\/]test[\\/]e2e[\\/]scenarios[\\/]/i.test(absHeaderPath);
          if (isScenarioArea && scenResolved) {
            const stamp = process.env.KNA_LOG_STAMP || '';
            const candidate = stamp
              ? buildScenarioLogPath(stamp, scenResolved)
              : path.join('logs', 'latest', 'e2e', `${scenResolved}.log`);
            const absLog = path.resolve(candidate).replace(/\\/g, '/').replace(/ /g, '%20');
            const line = `- log: file:///${absLog}`;
            let seen = this.printedLogLinesByFile.get(key);
            if (!seen) {
              seen = new Set<string>();
              this.printedLogLinesByFile.set(key, seen);
            }
            if (!seen.has(line)) {
              lines.push(line);
              seen.add(line);
              const bufX = this.buffers.get(key);
              if (bufX) bufX.hasExplicitLog = true;
            }
            const sm = this.scenarioLogsByFile.get(key);
            if (sm) {
              sm.delete(name);
              sm.delete(scenResolved);
            }
          } else {
            const sm = this.scenarioLogsByFile.get(key);
            const ln = sm?.get(name) ?? (scenResolved ? sm?.get(scenResolved) : undefined);
            if (ln) {
              lines.push(ln);
              sm!.delete(name);
              if (scenResolved) sm!.delete(scenResolved);
            }
          }
          const q = this.deferredLogsByFile.get(key);
          if (q && q.length) {
            lines.push(...q);
            q.length = 0;
          }
          buf.lines.push(...lines);
        }
        if (area && this.isScenarioAreaByKey(key)) {
          area.counts.total += 1;
          area.counts.skipped += 1;
        }
      }

      this.printedTests.add(String(id));

      // Track finished tests; rely on onTestSuiteFinished to close the area to avoid early close when counts are off
      if (area) {
        area.meta.finishedTests += 1;
        // If all tests in this area are done, close promptly so footer/logs appear without delay
        if (area.meta.totalTests > 0 && area.meta.finishedTests >= area.meta.totalTests) {
          this.scheduleClose(area.filePathAbs);
        } else if (this.finished.has(key)) {
          // Or if the suite reported finished, allow a debounced close now
          this.scheduleClose(area.filePathAbs);
        }
      }
    }
  }

  onUserConsoleLog(log: { content: string; task?: RunnerTask }): void {
    // If Vitest didn't attach a task/file (can happen for some async console logs),
    // try to attribute the log to the currently active area so we don't drop it.
    let filePath = '';
    if (!log.task?.file) {
      if (log.content.includes('📝 Logs for this run')) {
        this.ci.write('\n' + log.content);
      }
      return; // avoid mis-attributing stray logs to the wrong area
    } else {
      filePath = log.task.file.filepath || log.task.file.name || '';
    }
    if (!filePath) return;
    let trimmed = log.content.trimStart();
    // Strip any leading box pipe (e.g., "│ ") from ci.boxLine so pattern matching works
    trimmed = trimmed.replace(/^[|│]\s+/, '');
    if (!trimmed) return;

    const key = this.toKey(filePath);
    this.ensureInQueue(filePath);
    const buf = this.buffers.get(key) || { lines: [], hasExplicitLog: false };
    this.buffers.set(key, buf);

    // Do not switch active area based on console logs; enforce queue order

    // Mark start and activate if this is the head-of-queue
    this.maybeActivate(filePath);

    if (this.debugEnabled()) {
      this.noteFirst(filePath, 'console', trimmed.slice(0, 160));
    }

    // If a close was pending for this file, push it back slightly so we can include this log
    const maybeTimer = this.closeTimers.get(key);
    if (maybeTimer) {
      clearTimeout(maybeTimer);
      this.scheduleClose(filePath);
    }

    // Handle AreaFile override directive: /* CI: AreaFile <abs path> */
    if (trimmed.startsWith('/* CI:')) {
      const endIdx = trimmed.indexOf('*/');
      if (endIdx > 0) {
        const body = trimmed.substring(6, endIdx).trim();
        const [action, ...rest] = body.split(/\s+/);
        if (action === 'AreaFile') {
          const newPath = rest.join(' ');
          const area = this.getOrCreateArea(filePath);
          area.filePathAbs = path.resolve(newPath);
          // capture config path when AreaFile points at JSON
          if (/\.json$/i.test(newPath)) (area as any).meta.configPath = path.resolve(newPath);
          // If this is the active area and header not printed yet, ensure header now
          if (this.activeFileKey === key && !this.headerStarted.has(key)) {
            this.ensureHeader(filePath);
          }
          return;
        }
      }
    }

    // Accept step lines that begin with icons
    const mIcon = /^(✅|❌|⚠️|↩️)\s+(.*)$/.exec(trimmed);
    if (mIcon) {
      const rest = mIcon[2];
      const mLog = /^log:\s*(.+)$/i.exec(rest);
      // Count icon lines for non-scenario areas to drive footer totals
      const area = this.areas.get(key);
      if (area) {
        const isScenario = this.isScenarioAreaByKey(key);
        if (!isScenario) {
          area.counts.total += 1;
          if (mIcon[1] === '✅') area.counts.passed += 1;
          else if (mIcon[1] === '❌') area.counts.failed += 1;
          else if (mIcon[1] === '⚠️') area.counts.warning += 1;
          else if (mIcon[1] === '↩️') area.counts.skipped += 1;
        }
      }
      // Normalize runner 'Testing ...' lines (icon-based). Don't echo; we'll print our bullet from task events.
      const mTesting = /^Testing\s+(.+?)\.\.\.$/i.exec(rest);
      if (mTesting) {
        this.lastScenarioByFile.set(key, mTesting[1]);
        return;
      }
      if (mLog) {
        // For scenario areas, capture scenario log for deferred printing after summary; ensure steps now
        const isScenario = this.isScenarioAreaByKey(key);
        const url = mLog[1];
        const testId = (log.task as any)?.id ? String((log.task as any).id) : undefined;
        if (isScenario) {
          const m = /[\\/]e2e[\\/]([^\\/]+)\.log$/i.exec(url.replace(/%20/g, ' '));
          if (m) {
            const scenarioName = m[1];
            this.ensureScenarioStepsPrinted(key, scenarioName, filePath);
            let map = this.scenarioLogsByFile.get(key);
            if (!map) {
              map = new Map<string, string>();
              this.scenarioLogsByFile.set(key, map);
            }
            const testTitle = log.task?.name ?? scenarioName;
            const line = `- log: ${url}`;
            // Deduplicate if we've already printed this exact line for this file
            let seen = this.printedLogLinesByFile.get(key);
            if (!seen) {
              seen = new Set<string>();
              this.printedLogLinesByFile.set(key, seen);
            }
            if (seen.has(line)) {
              buf.hasExplicitLog = true; // still counts as explicit log seen
              return;
            }
            const lastPrinted = this.lastPrintedTestTitleByFile.get(key);
            if (lastPrinted && testTitle === lastPrinted) {
              if (this.activeFileKey === key) {
                this.ensureHeader(filePath);
                this.ci.boxLine(line);
              } else buf.lines.push(line);
              seen.add(line);
            } else if (testId && this.printedTests.has(testId)) {
              // Fallback: summary known by id
              if (this.activeFileKey === key) {
                this.ensureHeader(filePath);
                this.ci.boxLine(line);
              } else buf.lines.push(line);
              seen.add(line);
            } else {
              // Store by both test title and scenarioName for robust later retrieval
              map.set(String(testTitle), line);
              map.set(String(scenarioName), line);
            }
            buf.hasExplicitLog = true;
            return;
          }
        }
        // Non-scenario or unknown mapping: queue generically
        const line = `- log: ${url}`;
        // dedupe
        let seen = this.printedLogLinesByFile.get(key);
        if (!seen) {
          seen = new Set<string>();
          this.printedLogLinesByFile.set(key, seen);
        }
        if (seen.has(line)) {
          buf.hasExplicitLog = true;
          return;
        }
        if (testId && this.printedTests.has(testId)) {
          if (this.activeFileKey === key) {
            this.ensureHeader(filePath);
            this.ci.boxLine(line);
          } else buf.lines.push(line);
          seen.add(line);
        } else {
          let q = this.deferredLogsByFile.get(key);
          if (!q) {
            q = [];
            this.deferredLogsByFile.set(key, q);
          }
          q.push(line);
        }
        buf.hasExplicitLog = true;
        return;
      } else {
        // If this looks like a scenario bullet line, remember the scenario name for step rendering
        const mb = /^•\s+Testing\s+(.+?)\.\.\.$/.exec(rest);
        if (mb) this.lastScenarioByFile.set(key, mb[1]);
        if (this.activeFileKey === key) {
          this.ensureHeader(filePath);
          this.ci.boxLine(`- ${trimmed}`);
        } else buf.lines.push(`- ${trimmed}`);
      }
      return;
    }

    // Accept explicit log line (no icon)
    if (/^log:\s*/i.test(trimmed)) {
      // Defer logs for printing after summary; if summary already printed for this test, emit immediately
      const url = trimmed.replace(/^log:\s*/i, '');
      const testId = (log.task as any)?.id ? String((log.task as any).id) : undefined;
      const line = `- log: ${url}`;
      if (testId && this.printedTests.has(testId)) {
        if (this.activeFileKey === key) {
          this.ensureHeader(filePath);
          this.ci.boxLine(line);
        } else buf.lines.push(line);
      } else {
        let q = this.deferredLogsByFile.get(key);
        if (!q) {
          q = [];
          this.deferredLogsByFile.set(key, q);
        }
        q.push(line);
      }
      buf.hasExplicitLog = true;
      return;
    }

    // Accept group bullets
    if (/^•\s/.test(trimmed)) {
      // If this is a scenario bullet, record last scenario name for this file
      const mb = /^•\s+Testing\s+(.+?)\.\.\.$/.exec(trimmed);
      if (mb) this.lastScenarioByFile.set(key, mb[1]);
      if (this.activeFileKey === key) {
        this.ensureHeader(filePath);
        this.ci.boxLine(trimmed);
      } else buf.lines.push(trimmed);
      return;
    }

    // Accept any other non-empty line as plain output
    if (trimmed) {
      if (this.activeFileKey === key) {
        this.ensureHeader(filePath);
        this.ci.boxLine(trimmed);
      } else buf.lines.push(trimmed);
      return;
    }
  }

  // Legacy hooks kept for compatibility (Vitest v3 prefers onTaskUpdate)
  onTestSuccess(_trigger?: RunnerTask): void {}

  onTestSkipped(_trigger?: RunnerTask): void {}

  onTestFailed(_trigger?: RunnerTask, _errors?: unknown[]): void {}

  // Close an individual test file area when its suite finishes
  onTestSuiteFinished(trigger?: RunnerTask): void {
    const filePath = (trigger as any)?.file?.filepath || (trigger as any)?.file?.name;
    if (!filePath) return;
    const key = this.toKey(filePath);
    this.finished.add(key);
    const head = this.headOfQueue();
    // If the finishing suite is currently active, or it is the head and we haven't activated yet, close it
    if (this.activeFileKey === key || (!this.activeFileKey && head === key)) {
      if (!this.activeFileKey) this.switchArea(filePath);
      this.closeArea(filePath);
      // Advance through next files in order: if next not finished, activate its header so streaming begins immediately
      let idx = this.fileQueue.findIndex((p) => p === key);
      while (true) {
        idx += 1;
        if (idx >= this.fileQueue.length) break;
        const next = this.fileQueue[idx];
        if (this.closedAreas.has(next)) continue;
        const nextArea = this.areas.get(next);
        if (!nextArea) continue;
        // If the next area already finished, close it immediately; else activate (print header) and return to stream as events arrive
        if (this.finished.has(next)) {
          this.switchArea(nextArea.filePathAbs);
          this.closeArea(nextArea.filePathAbs);
          continue;
        } else {
          this.switchArea(nextArea.filePathAbs);
          return;
        }
      }
      // No more files pending
      this.activeFileKey = null;
      this.currentAreaKey = null;
    }
  }

  onFinished(_files: RunnerTestFile[]): void {
    // Ensure any remaining areas are closed in the preferred order
    const toPosix = (p: string) => p.replace(/\\/g, '/');
    const isSuite = (p: string) => /test\/e2e\/suite\.test\.ts$/i.test(toPosix(p));
    const isSchema = (p: string) =>
      /test\/e2e\/schema\/prompt-map\.schema\.test\.ts$/i.test(toPosix(p));
    const isScenario = (p: string) => /test\/e2e\/scenarios\/.+\/.+\.test\.ts$/i.test(toPosix(p));
    const remaining = this.fileQueue.filter((p) => !this.closedAreas.has(p));
    // We need original absolute paths to print headers/urls
    const keyToAbs = (k: string) => this.areas.get(k)?.filePathAbs ?? k;
    const ordered = [
      ...remaining.filter((k) => isSuite(keyToAbs(k))),
      ...remaining.filter((k) => isSchema(keyToAbs(k))),
      ...remaining.filter((k) => isScenario(keyToAbs(k))),
      ...remaining.filter((k) => {
        const abs = keyToAbs(k);
        return !isSuite(abs) && !isSchema(abs) && !isScenario(abs);
      }),
    ];
    for (const key of ordered) {
      if (!this.closedAreas.has(key)) {
        const abs = keyToAbs(key);
        this.activeFileKey = key;
        this.currentAreaKey = key;
        this.closeArea(abs);
      }
    }

    if (this.debugEnabled()) {
      const label = 'Reporter debug: first events timeline';
      this.ci.boxStart(label);
      const entries = Array.from(this.firstEventByFile.entries()).map(([k, v]) => ({ k, ...v }));
      entries.sort((a, b) => a.when - b.when);
      for (const e of entries) {
        const area = this.areas.get(e.k);
        const name = area?.name ?? e.k;
        this.ci.boxLine(
          `${String(e.when).padStart(5, ' ')}ms — ${name} — ${e.source}: ${e.snippet}`,
        );
      }
      this.ci.boxEnd('end first events');
      this.ci.write('');
    }
  }
}
