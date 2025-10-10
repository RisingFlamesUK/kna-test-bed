// suite/components/ci-emitter.ts
import type { Sev } from '../types/severity.ts';
import type { Logger } from '../types/logger.ts';
import { TestArea } from './test-area.ts';

/** Icons to use for severity levels in test output */
const ICON: Record<Sev, string> = { ok: '✅', warn: '⚠️', fail: '❌' };

/** Default width for box output */
const DEFAULT_BOX_WIDTH = 78;

/** Box drawing characters */
const BOX = {
  TOP_LEFT: '┌',
  VERTICAL: '│',
  BOTTOM_LEFT: '└',
  HORIZONTAL: '─',
};

/** Resolve an indent value (string or number) with a default */
function resolveIndent(indent: string | number | undefined, defaultIndent: string): string {
  if (indent == null) return defaultIndent;
  return typeof indent === 'number' ? ' '.repeat(indent) : indent;
}

/**
 * CI output logger implementation using similar patterns to proc.ts.
 * Implements the Logger interface for box drawing and output formatting,
 * then provides CI-specific methods for test output.
 */
export class CIEmitter implements Logger {
  private indent = '  ';
  filePath = ''; // Required by Logger interface

  /** Active test areas by file path */
  private testAreas = new Map<string, TestArea>();

  // Box handling implementation
  boxStart(title: string, opts?: { width?: number; indent?: string | number }): void {
    const ind = resolveIndent(opts?.indent, this.indent);
    const width = opts?.width ?? DEFAULT_BOX_WIDTH;
    console.log('');
    console.log(
      `${ind}${BOX.TOP_LEFT}${BOX.HORIZONTAL} ${title} ${BOX.HORIZONTAL.repeat(Math.max(0, width - title.length - 4))}`,
    );
  }

  boxLine(line: string, opts?: { width?: number; indent?: string | number }): void {
    const ind = resolveIndent(opts?.indent, this.indent);
    console.log(`${ind}${BOX.VERTICAL} ${line}`);
  }

  boxEnd(
    label: string,
    opts?: { width?: number; indent?: string | number; suffix?: string },
  ): void {
    const ind = resolveIndent(opts?.indent, this.indent);
    const suffix = opts?.suffix ?? '';
    const width = opts?.width ?? DEFAULT_BOX_WIDTH;
    console.log(
      `${ind}${BOX.BOTTOM_LEFT}${BOX.HORIZONTAL} ${label}${suffix} ${BOX.HORIZONTAL.repeat(Math.max(0, width - label.length - suffix.length - 4))}`,
    );
  }

  // Test area management
  private getOrCreateTestArea(filePath: string, title: string, indent?: string | number): TestArea {
    let area = this.testAreas.get(filePath);
    if (!area) {
      area = new TestArea(title, filePath, indent);
      this.testAreas.set(filePath, area);
      this.boxStart(title, { indent });
      this.boxLine(area.absPath, { indent });
      this.boxLine(`• Testing ${title}...`, { indent });
    }
    return area;
  }

  // Step output implementation
  step(title: string, details?: string, indent?: string | number): void {
    const ind = resolveIndent(indent, this.indent);
    console.log(`${ind}${title}`);
    if (details) console.log(`${ind}${details}`);
  }

  write(line: string, indent?: string | number): void {
    const ind = resolveIndent(indent, this.indent);
    console.log(`${ind}${line}`);
  }

  // Status output methods
  pass(msg = 'PASS', indent?: string | number): void {
    const ind = resolveIndent(indent, this.indent);
    console.log(`${ind}✅ ${msg}`);
  }

  warn(msg = 'WARN', indent?: string | number): void {
    const ind = resolveIndent(indent, this.indent);
    console.log(`${ind}⚠️ ${msg}`);
  }

  fail(msg: string, indent?: string | number): void {
    const ind = resolveIndent(indent, this.indent);
    console.log(`${ind}❌ ${msg}`);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  // Test run state tracking
  private printedRunHeader = false;

  // Test run entry point
  startRun(): void {
    if (this.printedRunHeader) return;
    this.write('Running tests...\n');
    this.printedRunHeader = true;
  }

  // Test area output methods
  testAreaStart(title: string, filePath: string, indent?: string | number): void {
    this.getOrCreateTestArea(filePath, title, indent);
  }

  testStep(line: string, status: Sev = 'ok', indent?: string | number): void {
    const ind = resolveIndent(indent, this.indent);
    this.boxLine(`- ${ICON[status]} ${line}`, { indent: ind });
  }

  testAreaEnd(
    result: string,
    logPath: string,
    counts: { passed: number; failed: number; skipped: number; total: number },
    indent?: string | number,
  ): void {
    const ind = resolveIndent(indent, this.indent);
    this.boxLine(`- ${result}`, { indent: ind });
    this.boxLine(`- log: ${TestArea.relFileUrl(logPath)}`, { indent: ind });
    this.boxEnd(
      `(Test Groups: ${counts.total}, passed: ${counts.passed}, failed: ${counts.failed}, warning: 0, skipped: ${counts.skipped})`,
      { indent: ind },
    );
  }

  // Legacy methods for backward compatibility
  suiteFile(filePath: string): void {
    this.testAreaStart('Docker PG Environment', filePath);
  }

  suiteStep(line: string): void {
    this.testStep(line);
  }

  suiteEnd(result: string, logPath: string, counts: { failed: number; skipped: number }): void {
    this.testAreaEnd(result, logPath, {
      total: 1,
      passed: counts.failed ? 0 : 1,
      failed: counts.failed,
      skipped: counts.skipped,
    });
  }

  schemaFile(filePath: string): void {
    this.testAreaStart('Scenario schema tests', filePath, '  ');
  }

  schemaStep(line: string): void {
    this.testStep(line, 'ok', '  ');
  }

  schemaEnd(result: string, logPath: string, counts: { failed: number; skipped: number }): void {
    this.testAreaEnd(
      result,
      logPath,
      {
        total: 1,
        passed: counts.failed ? 0 : 1,
        failed: counts.failed,
        skipped: counts.skipped,
      },
      '  ',
    );
  }

  // Scenario tracking state
  private scenarioArea: TestArea | null = null;
  private scenarioNames = new Set<string>();
  private pendingScenarios = new Set<string>();
  private scenDone = new Set<string>();
  private lastScenarioProgress = 0;
  private scenClosed = false;

  // Scenario output
  scenarioOpen(configPaths: string[]): void {
    this.scenarioArea = this.getOrCreateTestArea('scenarios.ts', 'Scenario tests', '  ');
    for (const path of configPaths) {
      this.testStep(TestArea.absFileUrl(path), 'ok', '  ');
    }
  }

  scenarioTest(name: string): void {
    if (this.scenClosed) return;
    this.scenarioNames.add(name);
    this.pendingScenarios.add(name);
    this.testStep(`Testing ${name}...`, 'ok', '  ');
  }

  scenarioCheck(step: 'scaffold' | 'env' | 'files', sev: Sev): void {
    if (this.scenClosed) return;
    this.testStep(`${step}: ${sev.toUpperCase()}`, sev, '  ');
  }

  scenarioLine(line: string, duration?: number): void {
    if (this.scenClosed) return;
    const durText =
      duration != null
        ? ` (${duration > 1000 ? (duration / 1000).toFixed(1) + 's' : duration + 'ms'})`
        : '';
    this.testStep(line + durText, 'ok', '  ');
  }

  scenarioDone(name: string, logPath: string): void {
    if (this.scenClosed || this.scenDone.has(name)) return;
    this.testStep(`log: ${TestArea.relFileUrl(logPath)}`, 'ok', '  ');
    this.scenDone.add(name);
    this.pendingScenarios.delete(name);

    // Update progress after completing a scenario
    if (this.scenDone.size > this.lastScenarioProgress) {
      this.lastScenarioProgress = this.scenDone.size;
      const total = this.scenarioNames.size;
      const done = this.scenDone.size;
      this.testStep(`Progress: ${done}/${total} scenarios complete`, 'ok', '  ');
    }
  }

  scenarioCloseSummary(totals: { names: string[]; ok: number; warn: number; fail: number }): void {
    if (this.scenClosed || this.pendingScenarios.size > 0 || this.scenarioNames.size === 0) return;

    if (this.scenarioArea) {
      this.testAreaEnd(
        `Scenario Tests Complete`,
        'e2e/scenarios.log',
        {
          total: this.scenarioNames.size,
          passed: totals.ok,
          failed: totals.fail,
          skipped: 0,
        },
        '  ',
      );
    }

    this.scenClosed = true;
  }
}
