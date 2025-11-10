// suite/reporter/collectors/hierarchy-collector.ts

import type { RunnerTestFile, RunnerTask } from 'vitest';
import type { BufferManager, HierarchyPosition } from '../core/buffer-manager.ts';
import {
  SUITE_TEST_PATTERN,
  SCHEMA_TEST_PATTERN,
  SCENARIO_TEST_PATTERN,
} from '../../components/constants.ts';
import * as path from 'path';

/**
 * Hierarchy Collector
 *
 * Builds test hierarchy from Vitest's task tree:
 * - Detects areas (Suite, Schema, Scenarios) from file paths
 * - Detects configs (simplified for now, can be enhanced)
 * - Extracts test groups (top-level suites)
 * - Extracts tests from suites
 * - Maps task IDs to hierarchy positions
 */
export class HierarchyCollector {
  private taskToHierarchy = new Map<string, HierarchyPosition>();
  private taskById = new Map<string, RunnerTask>();

  constructor(private bufferManager: BufferManager) {}

  /**
   * Collect tests from a batch of files
   */
  collectFiles(files: RunnerTestFile[]): void {
    for (const file of files) {
      this.collectFile(file);
    }
  }

  /**
   * Get hierarchy position for a task ID
   */
  getPosition(taskId: string): HierarchyPosition | undefined {
    return this.taskToHierarchy.get(taskId);
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): RunnerTask | undefined {
    return this.taskById.get(taskId);
  }

  /**
   * Get the first test ID in an area (for currentTaskId initialization)
   */
  getFirstTestId(areaKey: string): string | undefined {
    // Find first task that belongs to this area
    for (const [taskId, position] of this.taskToHierarchy.entries()) {
      if (position.area === areaKey && position.test) {
        return taskId;
      }
    }
    return undefined;
  }

  // ============================================================================
  // Private: File Collection
  // ============================================================================

  private collectFile(file: RunnerTestFile): void {
    const filePathAbs = path.resolve(file.filepath);

    // Determine area from file path
    const areaInfo = this.detectArea(filePathAbs);
    if (!areaInfo) {
      console.warn(`⚠️  Could not determine area for ${filePathAbs}`);
      return;
    }

    // Ensure area exists
    this.bufferManager.addArea(areaInfo.key, areaInfo.name);

    // Build hierarchy from tasks
    this.buildHierarchy(file, areaInfo.key);
  }

  private detectArea(filePathAbs: string): { key: string; name: string } | null {
    const posix = filePathAbs.split(path.sep).join('/');

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

  private buildHierarchy(file: RunnerTestFile, areaKey: string): void {
    // Detect config (simplified for now)
    const configKey = this.detectConfig(file, areaKey);
    const configName = configKey === 'none' ? areaKey : configKey;

    this.bufferManager.addConfig(areaKey, configKey, configName);

    // Walk task tree to extract test groups and tests
    if (file.tasks && Array.isArray(file.tasks)) {
      for (const task of file.tasks as RunnerTask[]) {
        this.extractTestsFromFile(task, areaKey, configKey);
      }
    }
  }

  private detectConfig(file: RunnerTestFile, areaKey: string): string {
    // Simplified config detection
    // TODO: Parse test file to detect tests.json references for scenarios

    if (areaKey === 'suite') return 'none';
    if (areaKey === 'schema') return 'main';

    // For scenarios, extract from path: test/e2e/scenarios/local-only/... -> local-only
    const posix = file.filepath.split(path.sep).join('/');
    const match = posix.match(/test\/e2e\/scenarios\/([^/]+)\//);
    return match ? match[1] : 'unknown';
  }

  private extractTestsFromFile(task: RunnerTask, areaKey: string, configKey: string): void {
    // Register this task
    this.taskById.set(task.id, task);

    if (task.type === 'suite') {
      const groupKey = this.normalizeKey(task.name);
      const groupName = task.name;

      this.bufferManager.addTestGroup(areaKey, configKey, groupKey, groupName);

      // Extract tests from this suite
      const anyTask = task as any;
      if (anyTask.tasks && Array.isArray(anyTask.tasks)) {
        for (const child of anyTask.tasks as RunnerTask[]) {
          if (child.type === 'test') {
            const testKey = this.normalizeKey(`${groupKey}__${child.name}`);
            const testName = child.name;

            this.bufferManager.addTest(areaKey, configKey, groupKey, testKey, testName);

            // Store task mapping for later lookup
            this.taskById.set(child.id, child);
            this.taskToHierarchy.set(child.id, {
              area: areaKey,
              config: configKey,
              testGroup: groupKey,
              test: testKey,
            });
          } else if (child.type === 'suite') {
            // Nested suite - recurse
            this.extractTestsFromFile(child, areaKey, configKey);
          }
        }
      }
    } else if (task.type === 'test') {
      // Standalone test (rare but handle it)
      const groupKey = 'standalone';
      const groupName = 'Standalone Tests';

      this.bufferManager.addTestGroup(areaKey, configKey, groupKey, groupName);

      const testKey = this.normalizeKey(task.name);
      const testName = task.name;

      this.bufferManager.addTest(areaKey, configKey, groupKey, testKey, testName);

      this.taskToHierarchy.set(task.id, {
        area: areaKey,
        config: configKey,
        testGroup: groupKey,
        test: testKey,
      });
    }
  }

  private normalizeKey(str: string): string {
    // Use same normalization as CI-CTX parser for consistency
    return str.toLowerCase().replace(/[^\w]+/g, '-');
  }
}
