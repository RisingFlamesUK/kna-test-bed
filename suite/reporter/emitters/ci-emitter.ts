// suite/reporter/emitters/ci-emitter.ts

import type { CI } from '../../types/ci.ts';
import type { Sev } from '../../types/severity.ts';

/**
 * Interface for output routing - reporters must implement this
 */
export interface OutputRouter {
  /**
   * Route output from a test task through the reporter's buffering/emission logic
   * @param taskId - Vitest task ID (undefined for unattributed output)
   * @param content - The output content to route
   */
  routeOutput(taskId: string | undefined, content: string): void;
}

/**
 * Reporter-Aware CI Wrapper
 *
 * This wrapper intercepts ALL CI output (boxStart, boxLine, write, etc.) and routes
 * it through the reporter's routeOutput() method instead of directly to console.
 *
 * This gives the reporter control over:
 * - When output appears (buffered vs immediate)
 * - Order of output (hierarchical area > config > group > test)
 * - Progressive streaming with delays
 *
 * Usage:
 * ```typescript
 * // In reporter:
 * const ciFactory = new CIEmitterFactory(this);
 *
 * // In test:
 * const ci = reporter.getCIForTask(taskId);
 * ci.write('test output'); // ← Routes through reporter, can be buffered
 * ```
 */
export class ReporterAwareCI implements CI {
  constructor(
    private router: OutputRouter,
    private taskId?: string,
  ) {}

  // ============================================================================
  // Core Output Methods - route through reporter
  // ============================================================================

  write(line: string, textIndent?: string | number): void {
    const indent = this.resolveIndent(textIndent, '  ');
    this.router.routeOutput(this.taskId, `${indent}${line}`);
  }

  boxStart(title: string, opts?: { width?: number; indent?: string | number }): void {
    const indent = this.resolveIndent(opts?.indent, '  ');
    const width = opts?.width ?? 78;
    this.router.routeOutput(this.taskId, '');
    this.router.routeOutput(
      this.taskId,
      `${indent}┌─ ${title} ${'─'.repeat(Math.max(0, width - title.length - 4))}`,
    );
  }

  boxLine(line: string, opts?: { width?: number; indent?: string | number }): void {
    const indent = this.resolveIndent(opts?.indent, '  ');
    // Shift leading dash content by two spaces without affecting the box border
    const shifted = line.startsWith('- ') ? `  ${line}` : line;
    this.router.routeOutput(this.taskId, `${indent}│ ${shifted}`);
  }

  boxEnd(
    label: string,
    opts?: { width?: number; indent?: string | number; suffix?: string },
  ): void {
    const indent = this.resolveIndent(opts?.indent, '  ');
    const suffix = opts?.suffix ?? '';
    const width = opts?.width ?? 78;
    this.router.routeOutput(
      this.taskId,
      `${indent}└─ ${label}${suffix} ${'─'.repeat(Math.max(0, width - label.length - suffix.length - 4))}`,
    );
  }

  step(title: string, details?: string, stepIndent?: string | number): void {
    const indent = this.resolveIndent(stepIndent, '  ');
    this.router.routeOutput(this.taskId, `${indent}${title}`);
    if (details) {
      this.router.routeOutput(this.taskId, `${indent}${details}`);
    }
  }

  testStep(line: string, status: Sev = 'ok', stepIndent?: string | number): void {
    const indent = this.resolveIndent(stepIndent, '  ');
    const icon = this.getIcon(status);
    this.router.routeOutput(this.taskId, `${indent}${icon} ${line}`);
  }

  pass(msg = 'PASS', statusIndent?: string | number): void {
    const indent = this.resolveIndent(statusIndent, '  ');
    this.router.routeOutput(this.taskId, `${indent}✅ ${msg}`);
  }

  warn(msg = 'WARN', statusIndent?: string | number): void {
    const indent = this.resolveIndent(statusIndent, '  ');
    this.router.routeOutput(this.taskId, `${indent}⚠️ ${msg}`);
  }

  fail(msg: string, statusIndent?: string | number): void {
    const indent = this.resolveIndent(statusIndent, '  ');
    this.router.routeOutput(this.taskId, `${indent}❌ ${msg}`);
  }

  // ============================================================================
  // Area-specific Methods (Suite, Schema, Scenarios)
  // ============================================================================

  testAreaStart(title: string, filePath: string, areaIndent?: string | number): void {
    this.boxStart(title, { indent: areaIndent });
    this.boxLine(`file:///${filePath.replace(/\\/g, '/').replace(/ /g, '%20')}`, {
      indent: areaIndent,
    });
    this.boxLine(`• Testing ${title}...`, { indent: areaIndent });
  }

  testAreaEnd(
    result: string,
    logPath: string,
    counts: { passed: number; failed: number; skipped: number; total: number },
    areaIndent?: string | number,
  ): void {
    const indent = this.resolveIndent(areaIndent, '  ');
    this.boxLine(`- ${result}`, { indent });
    this.boxLine(`- log: file:///${logPath.replace(/\\/g, '/').replace(/ /g, '%20')}`, { indent });
    this.boxEnd(
      `(Test Groups: ${counts.total}, passed: ${counts.passed}, failed: ${counts.failed}, warning: 0, skipped: ${counts.skipped})`,
      { indent },
    );
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

  scenarioOpen(configPaths: string[]): void {
    for (const path of configPaths) {
      this.testStep(`file:///${path.replace(/\\/g, '/').replace(/ /g, '%20')}`, 'ok', '  ');
    }
  }

  scenarioTest(name: string): void {
    this.testStep(`Testing ${name}...`, 'ok', '  ');
  }

  scenarioCheck(step: 'scaffold' | 'env' | 'files', sev: Sev): void {
    this.testStep(`${step}: ${sev.toUpperCase()}`, sev, '  ');
  }

  scenarioLine(line: string, duration?: number): void {
    const durText =
      duration != null
        ? ` (${duration > 1000 ? (duration / 1000).toFixed(1) + 's' : duration + 'ms'})`
        : '';
    this.testStep(line + durText, 'ok', '  ');
  }

  scenarioDone(name: string, logPath: string): void {
    this.testStep(`log: file:///${logPath.replace(/\\/g, '/').replace(/ /g, '%20')}`, 'ok', '  ');
  }

  scenarioCloseSummary(totals: { names: string[]; ok: number; warn: number; fail: number }): void {
    this.testAreaEnd(
      'Scenario Tests Complete',
      'e2e/scenarios.log',
      {
        total: totals.names.length,
        passed: totals.ok,
        failed: totals.fail,
        skipped: 0,
      },
      '  ',
    );
  }

  startRun(): void {
    this.router.routeOutput(this.taskId, '🧪 Running tests...\n');
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private resolveIndent(indent: string | number | undefined, defaultIndent: string): string {
    if (indent == null) return defaultIndent;
    return typeof indent === 'number' ? ' '.repeat(indent) : indent;
  }

  private getIcon(status: Sev): string {
    const icons: Record<Sev, string> = {
      ok: '✅',
      warn: '⚠️',
      fail: '❌',
      skip: '↩️',
    };
    return icons[status] || '✅';
  }
}

/**
 * Factory for creating ReporterAwareCI instances
 */
export class CIEmitterFactory {
  constructor(private router: OutputRouter) {}

  /**
   * Create a CI instance for a specific task
   */
  create(taskId?: string): CI {
    return new ReporterAwareCI(this.router, taskId);
  }

  /**
   * Create an unattributed CI instance (output goes to current open test)
   */
  createUnattributed(): CI {
    return new ReporterAwareCI(this.router, undefined);
  }
}
