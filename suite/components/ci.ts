// suite/components/ci.ts
import { type CI } from '../types/ci.ts';
import type { Sev } from '../types/severity.ts';
import { ICON } from '../types/ui.ts';
import { TestArea } from './test-area.ts';

/** Icons to use for severity levels in test output (centralized) */

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

function _fitLabel(label: string, maxLen: number): string {
  return label.length <= maxLen ? label : label.slice(0, maxLen);
}

function _makeRule(openGlyph: '┌' | '└', label: string, width: number): string {
  const head = `${openGlyph}─ `;
  const usable = Math.max(0, width - head.length);
  const text = _fitLabel(label, usable);
  const dashes = Math.max(0, usable - text.length);
  return head + text + '─'.repeat(dashes);
}

/**
 * Create a new CI instance for test output.
 * Follows the same pattern as logger.ts for consistency.
 */
export function createCI(): CI {
  const indent = '  ';

  /** Active test areas by file path */
  const testAreas = new Map<string, TestArea>();
  /** Have we printed the run header? */
  let printedRunHeader = false;
  /** Are we tracking scenarios? */
  let scenarioClosed = false;

  function getOrCreateTestArea(filePath: string, title: string, areaIndent?: string | number): TestArea {
    let area = testAreas.get(filePath);
    if (!area) {
      area = new TestArea(title, filePath, areaIndent);
      testAreas.set(filePath, area);
      ci.boxStart(title, { indent: areaIndent });
      ci.boxLine(area.absPath, { indent: areaIndent });
      ci.boxLine(`• Testing ${title}...`, { indent: areaIndent });
    }
    return area;
  }

  const ci: CI = {
    testAreaStart(title: string, filePath: string, areaIndent?: string | number) {
      getOrCreateTestArea(filePath, title, areaIndent);
    },

    testStep(line: string, status: Sev = 'ok', stepIndent?: string | number) {
      const ind = resolveIndent(stepIndent, indent);
      console.log(`${ind}${ICON[status]} ${line}`);
    },

    testAreaEnd(result: string, logPath: string, counts: { passed: number; failed: number; skipped: number; total: number }, areaIndent?: string | number) {
      const ind = resolveIndent(areaIndent, indent);
      ci.boxLine(`- ${result}`, { indent: ind });
      ci.boxLine(`- log: ${TestArea.relFileUrl(logPath)}`, { indent: ind });
      ci.boxEnd(
        `(Test Groups: ${counts.total}, passed: ${counts.passed}, failed: ${counts.failed}, warning: 0, skipped: ${counts.skipped})`,
        { indent: ind },
      );
    },

    startRun() {
      if (printedRunHeader) return;
      ci.write('Running tests...\n');
      printedRunHeader = true;
    },

    boxStart(title: string, opts?: { width?: number; indent?: string | number }) {
      const ind = resolveIndent(opts?.indent, indent);
      const width = opts?.width ?? DEFAULT_BOX_WIDTH;
      console.log('');
      console.log(
        `${ind}${BOX.TOP_LEFT}${BOX.HORIZONTAL} ${title} ${BOX.HORIZONTAL.repeat(Math.max(0, width - title.length - 4))}`,
      );
    },

    boxLine(line: string, opts?: { width?: number; indent?: string | number }) {
      const ind = resolveIndent(opts?.indent, indent);
      // Shift leading dash content by two spaces without affecting the box border
      const shifted = line.startsWith('- ')
        ? `  ${line}`
        : line;
      console.log(`${ind}${BOX.VERTICAL} ${shifted}`);
    },

    boxEnd(
      label: string,
      opts?: { width?: number; indent?: string | number; suffix?: string },
    ) {
      const ind = resolveIndent(opts?.indent, indent);
      const suffix = opts?.suffix ?? '';
      const width = opts?.width ?? DEFAULT_BOX_WIDTH;
      console.log(
        `${ind}${BOX.BOTTOM_LEFT}${BOX.HORIZONTAL} ${label}${suffix} ${BOX.HORIZONTAL.repeat(Math.max(0, width - label.length - suffix.length - 4))}`,
      );
    },

    step(title: string, details?: string, stepIndent?: string | number) {
      const ind = resolveIndent(stepIndent, indent);
      console.log(`${ind}${title}`);
      if (details) console.log(`${ind}${details}`);
    },

    write(line: string, textIndent?: string | number) {
      const ind = resolveIndent(textIndent, indent);
      console.log(`${ind}${line}`);
    },

    pass(msg = 'PASS', statusIndent?: string | number) {
      const ind = resolveIndent(statusIndent, indent);
      console.log(`${ind}✅ ${msg}`);
    },

    warn(msg = 'WARN', statusIndent?: string | number) {
      const ind = resolveIndent(statusIndent, indent);
      console.log(`${ind}⚠️ ${msg}`);
    },

    fail(msg: string, statusIndent?: string | number) {
      const ind = resolveIndent(statusIndent, indent);
      console.log(`${ind}❌ ${msg}`);
    },

    close() {
      return Promise.resolve();
    },

    // Special handlers for suite output
    suiteStep(line: string) {
      ci.testStep(line);
    },

    suiteEnd(result: string, logPath: string, counts: { failed: number; skipped: number }) {
      ci.testAreaEnd(
        result,
        logPath,
        {
          total: 1,
          passed: counts.failed ? 0 : 1,
          failed: counts.failed,
          skipped: counts.skipped,
        },
      );
    },

    // Special handlers for schema output
    schemaStep(line: string) {
      ci.testStep(line, 'ok', '  ');
    },

    schemaEnd(result: string, logPath: string, counts: { failed: number; skipped: number }) {
      ci.testAreaEnd(
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
    },

    // Scenario output methods
    scenarioOpen(configPaths: string[]) {
      const area = getOrCreateTestArea('scenarios.ts', 'Scenario tests', '  ');
      for (const path of configPaths) {
        ci.testStep(TestArea.absFileUrl(path), 'ok', '  ');
      }
    },

    scenarioTest(name: string) {
      if (scenarioClosed) return;
      ci.testStep(`Testing ${name}...`, 'ok', '  ');
    },

    scenarioCheck(step: 'scaffold' | 'env' | 'files', sev: Sev) {
      if (scenarioClosed) return;
      ci.testStep(`${step}: ${sev.toUpperCase()}`, sev, '  ');
    },

    scenarioLine(line: string, duration?: number) {
      if (scenarioClosed) return;
      const durText = duration != null
        ? ` (${duration > 1000 ? (duration / 1000).toFixed(1) + 's' : duration + 'ms'})`
        : '';
      ci.testStep(line + durText, 'ok', '  ');
    },

    scenarioDone(name: string, logPath: string) {
      if (scenarioClosed) return;
      ci.testStep(`log: ${TestArea.relFileUrl(logPath)}`, 'ok', '  ');
    },

    scenarioCloseSummary(totals: { names: string[]; ok: number; warn: number; fail: number }) {
      if (scenarioClosed) return;
      ci.testAreaEnd(
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
      scenarioClosed = true;
    },
  };

  return ci;
}