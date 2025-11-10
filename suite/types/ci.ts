// suite/types/ci.ts
import type { Sev } from './severity.ts';

export interface HierarchyContext {
  area?: string;
  config?: string;
  testGroup?: string;
  test?: string;
}

export interface CI {
  /** Start a new test area with title and file path */
  testAreaStart(title: string, filePath: string, indent?: string | number): void;

  /** Output a test step with optional severity and hierarchy context */
  testStep(line: string, status?: Sev, indent?: string | number, context?: HierarchyContext): void;

  /** Special handler for suite steps */
  suiteStep(line: string): void;

  /** Special handler for suite end */
  suiteEnd(result: string, logPath: string, counts: { failed: number; skipped: number }): void;

  /** Special handler for schema steps */
  schemaStep(line: string): void;

  /** Special handler for schema end */
  schemaEnd(result: string, logPath: string, counts: { failed: number; skipped: number }): void;

  /** Scenario output methods */
  scenarioOpen(configPaths: string[]): void;
  scenarioTest(name: string): void;
  scenarioCheck(step: 'scaffold' | 'env' | 'files', sev: Sev): void;
  scenarioLine(line: string, duration?: number): void;
  scenarioDone(name: string, logPath: string): void;
  scenarioCloseSummary(totals: { names: string[]; ok: number; warn: number; fail: number }): void;

  /** End a test area with summary information */
  testAreaEnd(
    result: string,
    logPath: string,
    counts: { passed: number; failed: number; skipped: number; total: number },
    indent?: string | number,
  ): void;

  /** Start running tests */
  startRun(): void;

  /** Box section controls for consistent output formatting */
  boxStart(title: string, opts?: { width?: number; indent?: string | number }): void;
  boxLine(line: string, opts?: { width?: number; indent?: string | number }): void;
  boxEnd(label: string, opts?: { width?: number; indent?: string | number; suffix?: string }): void;

  /** Standard status output methods */
  step(title: string, details?: string, indent?: string | number): void;
  write(line: string, indent?: string | number, context?: HierarchyContext): void;
  pass(msg?: string, indent?: string | number): void;
  warn(msg?: string, indent?: string | number): void;
  fail(msg: string, indent?: string | number): void;

  /** Close the CI output (if needed) */
  close(): Promise<void>;
}
