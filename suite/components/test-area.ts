// suite/components/test-area.ts
import * as path from 'node:path';
import type { Sev } from '../types/severity.ts';

export type TestAreaCounts = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
};

export class TestArea {
  readonly title: string;
  readonly filePath: string;
  readonly indent?: string | number;
  private steps: Array<{ message: string; status: Sev }> = [];
  private counts: TestAreaCounts = { total: 0, passed: 0, failed: 0, skipped: 0 };

  constructor(title: string, filePath: string, indent?: string | number) {
    this.title = title;
    this.filePath = filePath;
    this.indent = indent;
  }

  /** Convert an absolute path to a file:// URL */
  static absFileUrl(p: string): string {
    const resolved = path.resolve(p);
    const normalized = resolved.replace(/\\/g, '/');
    return `file:///${normalized}`;
  }

  /** Convert a relative path to a local file:// URL */
  static relFileUrl(rel: string): string {
    const normalized = rel.replace(/^[./\\]+/, '').replace(/\\/g, '/');
    return `file:././${normalized}`;
  }

  /** Get the absolute path URL for this test area's file */
  get absPath(): string {
    return TestArea.absFileUrl(this.filePath);
  }

  /** Get the relative log path for this test area */
  get logPath(): string {
    return path.join('e2e', path.basename(this.filePath).replace(/\.ts$/, '.log'));
  }

  /** Get the relative log URL for this test area */
  get logUrl(): string {
    return TestArea.relFileUrl(this.logPath);
  }

  /** Add a test step with status */
  addStep(message: string, status: Sev): void {
    this.steps.push({ message, status });
    this.counts.total++;
    if (status === 'ok') this.counts.passed++;
    else if (status === 'fail') this.counts.failed++;
  }

  /** Get the test area summary */
  getSummary(result: string): string {
    return `${path.basename(this.filePath)} • ${this.title} > ${result}`;
  }

  /** Get all steps */
  getSteps(): Array<{ message: string; status: Sev }> {
    return [...this.steps];
  }

  /** Get the current counts */
  getCounts(): TestAreaCounts {
    return { ...this.counts };
  }
}
