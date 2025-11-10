// suite/vitest-reporter-hierarchical.ts

import type { RunnerTestFile, RunnerTask } from 'vitest';
import type { Reporter } from 'vitest/reporter';
import { createCI } from './components/ci.ts';
import {
  SUITE_TEST_PATTERN,
  SCHEMA_TEST_PATTERN,
  SCENARIO_TEST_PATTERN,
  ENV_LOG_STAMP,
} from './components/constants.ts';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Hierarchical Reporter
 *
 * Produces hierarchical output: Area → Config → TestGroup → Test
 * Based on the proven patterns from vitest-reporter.ts but with hierarchy structure.
 *
 * Key design principles (learned from original reporter):
 * 1. Buffer by FILE PATH (not by 4-level hierarchy) - Vitest gives us file-level attribution
 * 2. Use task events to track "currently running test" per file
 * 3. Attribute arriving console logs to the last printed test in that file
 * 4. Hierarchy is for DISPLAY only - build it from task tree at collection time
 */
export default class HierarchicalReporter implements Reporter {
  private ci = createCI();

  // File-level buffers (keyed by normalized file path)
  private buffers = new Map<
    string,
    {
      lines: Array<{
        text: string;
        context?: { area?: string; config?: string; testGroup?: string; test?: string };
      }>;
      header: string;
    }
  >();

  // Track which test most recently printed per file (for console log attribution)
  private lastPrintedTestByFile = new Map<string, string>();

  // Track currently active test group (for console log attribution)
  private activeTestGroup: string | null = null;

  // Track active test group per file (for printing test group headings)
  private activeTestGroupByFile = new Map<string, string>();

  // Track which test groups have been printed per file (for Test Group headers)
  private printedTestGroups = new Map<string, Set<string>>();

  // Track task IDs we've already printed (avoid duplicates)
  private printedTests = new Set<string>();

  // Track test completion per file
  private testCompletionByFile = new Map<string, { total: number; completed: number }>();

  // Track test results per file for counts
  private testResultsByFile = new Map<
    string,
    { passed: number; failed: number; skipped: number }
  >();

  // File ordering queue (Suite → Schema → Scenarios)
  private fileQueue: string[] = [];
  private activeFileKey: string | null = null;
  private queueFinalized = false; // Set true once we start streaming
  private collectedKeys = new Set<string>(); // Track all collected files

  // Hierarchy structure (built from task tree)
  private hierarchy = new Map<string, FileHierarchy>();

  // Task lookup
  private taskById = new Map<string, RunnerTask>();

  private runStartMs = Date.now();

  onInit(): void {
    // Nothing to initialize
  }

  onCollected(files: RunnerTestFile[]): void {
    // Build hierarchy from collected files (onCollected may be called multiple times)
    for (const file of files) {
      const fileKey = this.toKey(file.filepath);

      // Track that we've seen this file
      this.collectedKeys.add(fileKey);

      const area = this.detectArea(file.filepath);

      if (!area) continue;

      // Build hierarchy for this file
      const hierarchy: FileHierarchy = {
        area: area.name,
        areaKey: area.key,
        filePathAbs: path.resolve(file.filepath),
        configs: new Map(),
      };

      // Walk task tree to extract test groups and tests
      if (file.tasks && Array.isArray(file.tasks)) {
        for (const task of file.tasks as RunnerTask[]) {
          this.extractHierarchy(task, hierarchy, area.key);
        }
      }

      this.hierarchy.set(fileKey, hierarchy);

      // Count total tests in this file for completion tracking
      let totalTests = 0;
      for (const [, config] of hierarchy.configs) {
        for (const [, testGroup] of config.testGroups) {
          totalTests += testGroup.tests.length;
        }
      }
      this.testCompletionByFile.set(fileKey, { total: totalTests, completed: 0 });

      // Initialize result counts
      this.testResultsByFile.set(fileKey, { passed: 0, failed: 0, skipped: 0 });

      // Add to queue in order
      if (!this.fileQueue.includes(fileKey)) {
        this.fileQueue.push(fileKey);
      }
    }

    // Don't finalize queue or activate files yet - wait for all onCollected calls
    // We'll activate on first onTaskUpdate or onUserConsoleLog
  }

  onTaskUpdate(packs: any[]): void {
    // Finalize queue on first task update
    if (!this.queueFinalized) {
      this.finalizeQueue();
    }

    for (const [taskId, result] of packs) {
      const task = this.taskById.get(taskId);
      if (!task || task.type !== 'test') continue;

      const filePath = (task.file as any)?.filepath || '';
      if (!filePath) continue;

      const fileKey = this.toKey(filePath);
      const state = result?.state ?? (task as any)?.result?.state;

      if (state === 'pass' || state === 'fail' || state === 'skip') {
        // Test completed - print summary if not already printed
        if (!this.printedTests.has(taskId)) {
          this.printTestSummary(fileKey, task, state);
          this.printedTests.add(taskId);
          this.lastPrintedTestByFile.set(fileKey, task.name);

          // Track result counts
          const results = this.testResultsByFile.get(fileKey);
          if (results) {
            if (state === 'pass') results.passed++;
            else if (state === 'fail') results.failed++;
            else if (state === 'skip') results.skipped++;
          }

          // Track completion
          const completion = this.testCompletionByFile.get(fileKey);
          if (completion) {
            completion.completed++;

            // If all tests in this file are complete, close the file
            if (completion.completed >= completion.total) {
              // Small delay to let any async console logs arrive
              setTimeout(() => {
                if (this.activeFileKey === fileKey) {
                  this.closeFile(fileKey);
                }
              }, 50);
            }
          }
        }
      }
    }
  }

  onUserConsoleLog(log: { content: string; task?: RunnerTask }): void {
    // Finalize queue on first console log
    if (!this.queueFinalized) {
      this.finalizeQueue();
    }

    // Get file path from task
    const filePath = log.task?.file?.filepath || '';

    // Split multi-line console logs into separate lines
    const lines = log.content.split('\n');

    for (const line of lines) {
      this.processConsoleLine(line, filePath, log.task);
    }
  }

  private processConsoleLine(line: string, filePath: string, _task?: RunnerTask): void {
    // Clean up the content
    let trimmed = line.trim();

    // Skip completely empty lines
    if (!trimmed) return;

    // Extract hierarchy context if present
    let hierarchyContext: {
      area?: string;
      config?: string;
      testGroup?: string;
      test?: string;
    } | null = null;
    const hierarchyMatch = trimmed.match(/^\[HIERARCHY:(.*?)\](.*)/);
    if (hierarchyMatch) {
      try {
        hierarchyContext = JSON.parse(hierarchyMatch[1]);
        trimmed = hierarchyMatch[2]; // Remove the prefix
      } catch {
        // Invalid JSON, ignore context
      }
    }

    // Strip box pipe if present (from ci.boxLine calls that already added it)
    trimmed = trimmed.replace(/^[|│]\s*/, '');

    // Skip if nothing left after stripping
    if (!trimmed) return;

    // Filter out progress messages that shouldn't appear in output
    // These are testStep calls that are just progress indicators, not results
    if (trimmed.includes('Installing dependencies - this can take')) return;
    if (trimmed.includes('Running npm install to simulate')) return;
    if (trimmed.match(/^•\s+Testing\s+/)) return; // "Testing local-only-*..." progress indicators

    // Determine target file key
    let fileKey: string | null = null;

    // Use hierarchy context if present for accurate routing
    if (hierarchyContext?.area) {
      fileKey = this.findFileByAreaKey(hierarchyContext.area as any);
    } else if (filePath) {
      // Has task attribution - use it
      fileKey = this.toKey(filePath);
    } else {
      // No task attribution - try to infer from log file URLs or content
      if (trimmed.match(/log:.*suite-sentinel\.log/)) {
        fileKey = this.findFileByAreaKey('suite');
      } else if (trimmed.match(/log:.*schema-validation\.log/)) {
        fileKey = this.findFileByAreaKey('schema');
      } else if (trimmed.match(/log:.*local-only/)) {
        // Log URL or content mentioning local-only scenarios
        fileKey = this.findFileByAreaKey('scenarios');
      } else if (trimmed.match(/scaffold:|env manifest|files manifest|mergeEnv:/)) {
        // Step output - likely from scenarios (but could be schema)
        // Check if we have a scenarios file in the queue
        const scenariosKey = this.findFileByAreaKey('scenarios');
        if (scenariosKey) {
          fileKey = scenariosKey;
        } else {
          fileKey = this.activeFileKey;
        }
      } else {
        // Can't determine from content - buffer to active file
        fileKey = this.activeFileKey;
      }
    }

    if (!fileKey) {
      // No file attribution and no active file - print directly if it's the final summary
      if (trimmed.includes('📝 Logs for this run')) {
        this.ci.write('\n' + trimmed);
      }
      return;
    }

    // Get or create buffer
    const buf = this.buffers.get(fileKey) || { lines: [], header: '' };
    this.buffers.set(fileKey, buf);

    // Activate file if it's next in queue
    if (!this.activeFileKey && fileKey === this.fileQueue[0]) {
      this.activateFile(fileKey);
    }

    // If this file is active, print immediately; otherwise buffer
    if (this.activeFileKey === fileKey) {
      // Check if we need to print a Test Group header
      if (hierarchyContext?.testGroup) {
        const printedForFile = this.printedTestGroups.get(fileKey) || new Set<string>();
        if (!printedForFile.has(hierarchyContext.testGroup)) {
          // Print Test Group header
          this.ci.boxLine(`  Test Group: ${hierarchyContext.testGroup}`);
          printedForFile.add(hierarchyContext.testGroup);
          this.printedTestGroups.set(fileKey, printedForFile);
        }
      }

      this.ci.boxLine(trimmed);
    } else {
      buf.lines.push({ text: trimmed, context: hierarchyContext || undefined });
    }
  }

  onFinished(_files: RunnerTestFile[]): void {
    // Wait a moment for any pending closes to complete
    setTimeout(() => {
      // Close any remaining active file
      if (this.activeFileKey) {
        this.closeFile(this.activeFileKey);
      }

      const elapsed = Date.now() - this.runStartMs;
      console.log(`\n✅ Test run complete in ${(elapsed / 1000).toFixed(2)}s`);
    }, 100);
  }

  // ============================================================================
  // Private: Queue Finalization
  // ============================================================================

  private finalizeQueue(): void {
    if (this.queueFinalized) return;

    // Don't finalize yet if Suite hasn't been collected and we have Schema
    // (Suite should always go first)
    const hasSuite = Array.from(this.collectedKeys).some((k) => {
      const hier = this.hierarchy.get(k);
      return hier?.areaKey === 'suite';
    });
    const hasSchema = Array.from(this.collectedKeys).some((k) => {
      const hier = this.hierarchy.get(k);
      return hier?.areaKey === 'schema';
    });

    if (hasSchema && !hasSuite) {
      // Wait for Suite to be collected before starting
      return;
    }

    this.queueFinalized = true;

    // Sort queue: Suite → Schema → Scenarios
    this.fileQueue.sort((a, b) => {
      const priorityA = this.getAreaPriority(a);
      const priorityB = this.getAreaPriority(b);
      return priorityA - priorityB;
    });

    // Activate first file
    if (this.fileQueue.length > 0 && !this.activeFileKey) {
      this.activateFile(this.fileQueue[0]);
    }
  }

  // ============================================================================
  // Private: Hierarchy Building
  // ============================================================================

  private extractHierarchy(task: RunnerTask, hierarchy: FileHierarchy, areaKey: string): void {
    this.taskById.set(task.id, task);

    if (task.type === 'suite') {
      // Suite = Test Group in our hierarchy
      const testGroupKey = this.normalizeKey(task.name);
      const testGroupName = task.name;

      // Detect config (simplified for now)
      const configKey = this.detectConfig(hierarchy.filePathAbs, areaKey);
      const configName = configKey === 'none' ? areaKey : configKey;

      // Ensure config exists
      if (!hierarchy.configs.has(configKey)) {
        hierarchy.configs.set(configKey, {
          key: configKey,
          name: configName,
          testGroups: new Map(),
        });
      }

      const config = hierarchy.configs.get(configKey)!;

      // Ensure test group exists
      if (!config.testGroups.has(testGroupKey)) {
        config.testGroups.set(testGroupKey, {
          key: testGroupKey,
          name: testGroupName,
          tests: [],
        });
      }

      const testGroup = config.testGroups.get(testGroupKey)!;

      // Extract tests from this suite
      const anyTask = task as any;
      if (anyTask.tasks && Array.isArray(anyTask.tasks)) {
        for (const child of anyTask.tasks as RunnerTask[]) {
          if (child.type === 'test') {
            this.taskById.set(child.id, child);
            testGroup.tests.push({
              id: child.id,
              name: child.name,
            });
          } else if (child.type === 'suite') {
            // Nested suite - recurse
            this.extractHierarchy(child, hierarchy, areaKey);
          }
        }
      }
    }
  }

  private detectConfig(filePathAbs: string, areaKey: string): string {
    // Simplified config detection
    if (areaKey === 'suite') return 'none';
    if (areaKey === 'schema') return 'main';

    // For scenarios, extract from path: test/e2e/scenarios/local-only/... -> local-only
    const posix = filePathAbs.split(path.sep).join('/');
    const match = posix.match(/test\/e2e\/scenarios\/([^/]+)\//);
    return match ? match[1] : 'unknown';
  }

  // ============================================================================
  // Private: File Activation and Output
  // ============================================================================

  private activateFile(fileKey: string): void {
    this.activeFileKey = fileKey;
    const hier = this.hierarchy.get(fileKey);
    if (!hier) return;

    // Print area header
    this.printAreaHeader(hier);

    // Flush any buffered lines for this file
    const buf = this.buffers.get(fileKey);
    if (buf && buf.lines.length > 0) {
      for (const item of buf.lines) {
        // Check if we need to print a Test Group header before this line
        if (item.context?.testGroup) {
          const printedForFile = this.printedTestGroups.get(fileKey) || new Set<string>();
          if (!printedForFile.has(item.context.testGroup)) {
            // Print Test Group header
            this.ci.boxLine(`  Test Group: ${item.context.testGroup}`);
            printedForFile.add(item.context.testGroup);
            this.printedTestGroups.set(fileKey, printedForFile);
          }
        }

        this.ci.boxLine(item.text);
      }
      buf.lines = [];
    }
  }

  private closeFile(fileKey: string): void {
    const hier = this.hierarchy.get(fileKey);
    if (!hier) return;

    // Print area footer
    this.printAreaFooter(hier);

    // Move to next file
    const currentIndex = this.fileQueue.indexOf(fileKey);
    if (currentIndex >= 0 && currentIndex + 1 < this.fileQueue.length) {
      const nextKey = this.fileQueue[currentIndex + 1];
      this.activateFile(nextKey);
    } else {
      this.activeFileKey = null;
    }
  }

  private printAreaHeader(hier: FileHierarchy): void {
    this.ci.write('');
    this.ci.boxStart(`Area: ${hier.area}`);

    // Print configs
    for (const [configKey, config] of hier.configs) {
      if (configKey !== 'none') {
        this.ci.boxLine(`Config: ${config.name}`);
      }

      // Test groups will print themselves when they run (for scenarios)
      // For Suite and Schema, they don't have test groups in the same way
    }
  }

  private printAreaFooter(hier: FileHierarchy): void {
    const fileKey = this.toKey(hier.filePathAbs);

    let testCount = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let warn = 0;

    // Load counts from detail JSON files based on area
    if (hier.areaKey === 'scenarios') {
      const detail = this.loadScenarioDetail();
      if (detail) {
        // Scenario detail is an object: { testGroup: { scaffold: {...}, env: {...}, files: {...} } }
        for (const testGroup of Object.keys(detail)) {
          const steps = detail[testGroup] || {};
          for (const stepName of ['scaffold', 'env', 'files']) {
            if (steps[stepName]) {
              testCount++;
              const sev = steps[stepName].severity;
              if (sev === 'ok') passed++;
              else if (sev === 'fail') failed++;
              else if (sev === 'warn') warn++;
              else if (sev === 'skip') skipped++;
            }
          }
        }
      }
    } else if (hier.areaKey === 'schema') {
      const detail = this.loadSchemaDetail();
      if (detail && Array.isArray(detail)) {
        // Schema detail is an array: [{ severity: 'ok', message: '...' }, ...]
        testCount = detail.length;
        for (const item of detail) {
          const sev = item.severity;
          if (sev === 'ok') passed++;
          else if (sev === 'fail') failed++;
          else if (sev === 'warn') warn++;
          else if (sev === 'skip') skipped++;
        }
      }
    } else if (hier.areaKey === 'suite') {
      const detail = this.loadSuiteDetail();
      if (detail && Array.isArray(detail)) {
        // Suite detail is an array: [{ severity: 'ok', message: '...' }, ...]
        testCount = detail.length;
        for (const item of detail) {
          const sev = item.severity;
          if (sev === 'ok') passed++;
          else if (sev === 'fail') failed++;
          else if (sev === 'warn') warn++;
          else if (sev === 'skip') skipped++;
        }
      }
    }

    // Fallback to Vitest counts if detail files not available
    if (testCount === 0) {
      const results = this.testResultsByFile.get(fileKey) || { passed: 0, failed: 0, skipped: 0 };
      // Count Vitest tests
      for (const [, config] of hier.configs) {
        for (const [, testGroup] of config.testGroups) {
          testCount += testGroup.tests.length;
        }
      }
      passed = results.passed;
      failed = results.failed;
      skipped = results.skipped;
    }

    this.ci.boxEnd(
      `(Tests: ${testCount}, passed: ${passed}, failed: ${failed}, warning: ${warn}, skipped: ${skipped})`,
    );
  }

  private printTestSummary(_fileKey: string, _task: RunnerTask, _state: string): void {
    // Don't print ANY Vitest test results
    // All areas use either step-based output (console logs) or detail JSON for counts
    // Vitest test results (from onTaskUpdate) should not be displayed
    return;
  }

  private loadScenarioDetail(): any | null {
    const stamp = process.env[ENV_LOG_STAMP] || '';
    if (!stamp) return null;
    const e2eDir = path.resolve('logs', stamp, 'e2e');
    const p = path.join(e2eDir, '_scenario-detail.json');
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }

  private loadSchemaDetail(): any | null {
    const stamp = process.env[ENV_LOG_STAMP] || '';
    if (!stamp) return null;
    const e2eDir = path.resolve('logs', stamp, 'e2e');
    const p = path.join(e2eDir, '_schema-detail.json');
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }

  private loadSuiteDetail(): any | null {
    const stamp = process.env[ENV_LOG_STAMP] || '';
    if (!stamp) return null;
    const e2eDir = path.resolve('logs', stamp, 'e2e');
    const p = path.join(e2eDir, '_suite-detail.json');
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }

  // ============================================================================
  // Private: Area Detection and Ordering
  // ============================================================================

  private detectArea(filePath: string): { key: string; name: string } | null {
    const posix = filePath.split(path.sep).join('/');

    if (SUITE_TEST_PATTERN.test(posix)) {
      return { key: 'suite', name: 'Suite' };
    }
    if (SCHEMA_TEST_PATTERN.test(posix)) {
      return { key: 'schema', name: 'Schema' };
    }
    if (SCENARIO_TEST_PATTERN.test(posix)) {
      return { key: 'scenarios', name: 'Scenarios' };
    }

    return null;
  }

  private getAreaPriority(fileKey: string): number {
    const hier = this.hierarchy.get(fileKey);
    if (!hier) return 999;

    const priorities: Record<string, number> = {
      suite: 1,
      schema: 2,
      scenarios: 3,
    };

    return priorities[hier.areaKey] || 999;
  }

  private toKey(filePath: string): string {
    return path.resolve(filePath).toLowerCase().replace(/\\/g, '/');
  }

  private normalizeKey(str: string): string {
    return str.toLowerCase().replace(/[^\w]+/g, '-');
  }

  private findFileByTestGroup(testGroupName: string): string | null {
    // Search through hierarchy to find which file contains this test group
    for (const [fileKey, hier] of this.hierarchy.entries()) {
      for (const [, config] of hier.configs) {
        for (const [groupKey] of config.testGroups) {
          // Match by normalized key OR by exact name
          if (groupKey === testGroupName || groupKey === this.normalizeKey(testGroupName)) {
            return fileKey;
          }
        }
      }
    }
    return null;
  }

  private findFileByAreaKey(areaKey: string): string | null {
    // Search through hierarchy to find which file has this area key
    for (const [fileKey, hier] of this.hierarchy.entries()) {
      if (hier.areaKey === areaKey) {
        return fileKey;
      }
    }
    return null;
  }
}

// ============================================================================
// Types
// ============================================================================

interface FileHierarchy {
  area: string;
  areaKey: string;
  filePathAbs: string;
  configs: Map<string, ConfigHierarchy>;
}

interface ConfigHierarchy {
  key: string;
  name: string;
  testGroups: Map<string, TestGroupHierarchy>;
}

interface TestGroupHierarchy {
  key: string;
  name: string;
  tests: TestInfo[];
}

interface TestInfo {
  id: string;
  name: string;
}
