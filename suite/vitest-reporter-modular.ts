// suite/vitest-reporter-modular.ts

import type { RunnerTestFile, RunnerTask } from 'vitest';
import type { Reporter } from 'vitest/reporter';
import type { CI } from './types/ci.ts';
import { BufferManager, type HierarchyPosition } from './reporter/core/buffer-manager.ts';
import { OrderingManager } from './reporter/core/ordering.ts';
import { HierarchyCollector } from './reporter/collectors/hierarchy-collector.ts';
import { CIEmitterFactory, type OutputRouter } from './reporter/emitters/ci-emitter.ts';
import { registerReporter, clearReporter } from './components/reporter-registry.ts';

/**
 * Modular Hierarchical Reporter
 *
 * Provides strict hierarchical output ordering: Area → Config → Test Group → Test
 * All output (console.log AND ci.write) is routed through the reporter for buffering.
 *
 * Architecture:
 * - BufferManager: Manages hierarchical buffers and open path
 * - HierarchyCollector: Builds test hierarchy from Vitest task tree
 * - OrderingManager: Determines area ordering (Suite → Schema → Scenarios)
 * - CIEmitterFactory: Provides reporter-aware CI instances to tests
 */
export default class ModularReporter implements Reporter, OutputRouter {
  private bufferManager = new BufferManager((line) => this.emitImmediately(line));
  private orderingManager = new OrderingManager();
  private hierarchyCollector = new HierarchyCollector(this.bufferManager);
  private ciFactory = new CIEmitterFactory(this);

  private hasStartedStreaming = false;
  private collectedAreas = new Set<string>();
  private currentTaskId: string | undefined;

  private runStartMs = Date.now();

  constructor() {
    // Register immediately when reporter is instantiated
    // This ensures tests can get router even if onInit() hasn't been called yet
    registerReporter(this);

    // Intercept stdout to catch [HIER:...] prefixed output
    this.installStdoutIntercept();
  }

  // ============================================================================
  // Vitest Reporter Lifecycle Hooks
  // ============================================================================

  onInit(): void {
    // Already registered in constructor, but reinforce here for clarity
    registerReporter(this);

    // Pre-initialize canonical areas in BufferManager to ensure correct ordering
    // But DON'T add to collectedAreas - let onCollected track actual collection
    const canonicalAreas = this.orderingManager.getCanonicalAreas();
    for (const { key, name } of canonicalAreas) {
      this.bufferManager.addArea(key, name);
    }
  }

  onCollected(files: RunnerTestFile[]): void {
    // Build hierarchy from collected files
    this.hierarchyCollector.collectFiles(files);

    // Track which areas we've collected
    for (const file of files) {
      const area = this.detectAreaFromFile(file);
      if (area) {
        this.collectedAreas.add(area);
      }
    }

    // Finalize area order
    const _orderedAreas = this.orderingManager.getOrderedAreas(Array.from(this.collectedAreas));

    // Store ordered areas back in buffer manager
    // (BufferManager will use this order for cascading opens)

    // DON'T flush pending output here - test modules are still executing
    // Will flush at start of onTaskUpdate when tests actually run
  }

  onTaskUpdate(packs: any[]): void {
    // Start streaming on first task update
    this.ensureStreamingStarted();

    for (const [taskId, result] of packs) {
      const task = this.hierarchyCollector.getTask(taskId);
      if (!task) continue;

      // Track currently running test for console log attribution
      const state = result?.state ?? (task as any)?.result?.state;

      if (task.type === 'test' && (state === 'run' || state === 'pass' || state === 'fail')) {
        // Update current task for console log attribution
        // (Already set in ensureStreamingStarted, but update if test changes)
        if (this.currentTaskId !== taskId) {
          this.currentTaskId = taskId;
        }

        // DON'T force-open tests here - let cascade logic drive test opening
        // The hierarchy will open tests based on area ordering and forward/downward cascade
      }

      this.handleTaskUpdate(task, result);

      // Clear current task when test completes
      if (task.type === 'test' && (state === 'pass' || state === 'fail' || state === 'skip')) {
        if (this.currentTaskId === taskId) {
          this.currentTaskId = undefined;
        }
      }
    }
  }

  onUserConsoleLog(log: { content: string; task?: RunnerTask }): void {
    // Start streaming on first console log
    this.ensureStreamingStarted();

    const content = log.content;
    const task = log.task;

    // Try to get position from task or current task
    let position: HierarchyPosition | null = null;
    if (task) {
      position = this.hierarchyCollector.getPosition(task.id) ?? null;
    } else if (this.currentTaskId) {
      position = this.hierarchyCollector.getPosition(this.currentTaskId) ?? null;
    }

    if (position) {
      // Route through buffer manager - it will buffer or emit based on open path
      this.bufferManager.routeOutput(position, content);
    } else {
      // No position - emit immediately
      this.emitImmediately(content);
    }
  }

  // ============================================================================
  // Stdout Interception for [HIER:...] Prefixed Output
  // ============================================================================

  private originalStdoutWrite: typeof process.stdout.write | null = null;

  private installStdoutIntercept(): void {
    this.originalStdoutWrite = process.stdout.write.bind(process.stdout);

    process.stdout.write = ((chunk: any, ...args: any[]): boolean => {
      const str = chunk?.toString() ?? '';

      // Check for [HIER:area:config:testGroup:test] prefix
      const match = str.match(/^\[HIER:([^:]+):([^:]+):([^:]+):([^\]]+)\](.*)$/s);

      if (match) {
        const [, area, config, testGroup, test, content] = match;

        // Normalize keys to match hierarchy collector format
        const normalizedArea = area.toLowerCase().replace(/[^\w]+/g, '-');
        const normalizedConfig = config.toLowerCase().replace(/[^\w]+/g, '-');
        const normalizedTestGroup = testGroup.toLowerCase().replace(/[^\w]+/g, '-');
        const normalizedTest = test.toLowerCase().replace(/[^\w]+/g, '-');

        const position: HierarchyPosition = {
          area: normalizedArea,
          config: normalizedConfig,
          testGroup: normalizedTestGroup,
          test: `${normalizedTestGroup}__${normalizedTest}`,
        };

        // Route through buffer manager
        this.bufferManager.routeOutput(position, content.trimEnd());

        return true; // Indicate write was handled
      }

      // Not a [HIER] prefixed line - pass through to original stdout
      return this.originalStdoutWrite!(chunk, ...args);
    }) as typeof process.stdout.write;
  }

  onFinished(_files: RunnerTestFile[]): void {
    // Ensure all areas are closed
    // (BufferManager will cascade close remaining open items)

    // Clear reporter registry
    clearReporter();

    const elapsed = Date.now() - this.runStartMs;
    console.log(`\n✅ Test run complete in ${(elapsed / 1000).toFixed(2)}s`);
  }

  // ============================================================================
  // OutputRouter Interface (for CIEmitterFactory)
  // ============================================================================

  // ============================================================================
  // OutputRouter Interface (for CIEmitterFactory)
  // ============================================================================

  routeOutput(taskId: string | undefined, content: string): void {
    if (!taskId) {
      // Unattributed output - emit to current open test
      const openState = this.bufferManager.getOpenState();
      if (openState.test) {
        this.emitImmediately(content);
      }
      return;
    }

    const position = this.hierarchyCollector.getPosition(taskId);
    if (position) {
      this.bufferManager.routeOutput(position, content);
    } else {
      // Unknown task - emit to current open test if any
      const openState = this.bufferManager.getOpenState();
      if (openState.test) {
        this.emitImmediately(content);
      }
    }
  }

  // ============================================================================
  // Public API for Tests
  // ============================================================================

  /**
   * Get a CI instance for a specific task
   * Tests should call this to get a reporter-aware CI instance
   */
  getCIForTask(taskId: string): CI {
    return this.ciFactory.create(taskId);
  }

  /**
   * Get an unattributed CI instance
   * Uses the currently running test if available
   */
  getCI(): CI {
    if (this.currentTaskId) {
      return this.ciFactory.create(this.currentTaskId);
    }
    return this.ciFactory.createUnattributed();
  }

  // ============================================================================
  // Private: Streaming Control
  // ============================================================================

  private ensureStreamingStarted(): void {
    if (this.hasStartedStreaming) return;

    // Check if we have required areas
    if (!this.orderingManager.hasRequiredAreas(this.collectedAreas)) {
      return;
    }

    this.hasStartedStreaming = true;

    // Get ordered areas
    const orderedAreas = this.orderingManager.getOrderedAreas(Array.from(this.collectedAreas));

    // Open first area
    if (orderedAreas.length > 0) {
      this.bufferManager.openArea(orderedAreas[0], (line) => this.emitImmediately(line));

      // Set currentTaskId to the first test in the first area
      // This ensures console.log attribution works before onTaskUpdate fires
      const firstTestId = this.hierarchyCollector.getFirstTestId(orderedAreas[0]);
      if (firstTestId) {
        this.currentTaskId = firstTestId;
      }
    }
  }

  private handleTaskUpdate(task: RunnerTask, result: any): void {
    if (task.type !== 'test') return;

    const position = this.hierarchyCollector.getPosition(task.id);
    if (!position) return;

    // Update test status
    const state: string | undefined = result?.state ?? (task as any)?.result?.state;
    if (!state) return;

    // Handle test completion - only close if on open path
    if (state === 'pass' || state === 'fail' || state === 'skip') {
      const position = this.hierarchyCollector.getPosition(task.id);
      if (position && position.config && position.testGroup && position.test) {
        // Update test status in buffer
        this.bufferManager.setTestStatus(
          position.area,
          position.config,
          position.testGroup,
          position.test,
          state,
        );

        // Only close the test if it's on the open path
        // This prevents tests from other areas triggering cascade prematurely
        const openState = this.bufferManager.getOpenState();
        const isOnOpenPath =
          openState.area === position.area &&
          openState.config === position.config &&
          openState.testGroup === position.testGroup &&
          openState.test === position.test;

        if (isOnOpenPath) {
          // Close the test, which will cascade to opening the next test
          this.bufferManager.closeTest(
            position.area,
            position.config,
            position.testGroup,
            position.test,
            (line) => this.emitImmediately(line),
          );
        }
      }
    }
  }

  private emitImmediately(content: string): void {
    // Use process.stdout.write to bypass Vitest's console intercept
    // (prevents infinite loop where our output gets intercepted again)
    process.stdout.write(content + '\n');
  }

  private detectAreaFromFile(file: RunnerTestFile): string | null {
    const posix = file.filepath.split(/[\\/ ]/).join('/');

    if (/test\/e2e(?:\/suite)?\/suite\.test\.ts$/i.test(posix)) {
      return 'suite';
    }
    if (/test\/e2e\/schema\/schema-validation\.test\.ts$/i.test(posix)) {
      return 'schema';
    }
    if (/test\/e2e\/scenarios\/.+\/.+\.test\.ts$/i.test(posix)) {
      return 'scenarios';
    }

    return null;
  }
}
