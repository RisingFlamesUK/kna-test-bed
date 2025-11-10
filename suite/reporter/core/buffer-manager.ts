// suite/reporter/core/buffer-manager.ts

/**
 * Hierarchical Buffer Manager
 *
 * Manages 4-level hierarchy: Area → Config → Test Group → Test
 * Maintains single "open path" - only ONE item open at each level
 *
 * Output routing:
 * - If task is on open path → emit immediately to console
 * - Otherwise → buffer for later, flush progressively when opened
 */

export interface TestBuffer {
  key: string;
  name: string;
  lines: string[];
  status: 'pass' | 'fail' | 'skip' | null;
  hasOutput: boolean;
}

export interface TestGroupBuffer {
  key: string;
  name: string;
  tests: Map<string, TestBuffer>;
  testOrder: string[];
  isComplete: boolean;
}

export interface ConfigBuffer {
  key: string;
  name: string;
  testGroups: Map<string, TestGroupBuffer>;
  groupOrder: string[];
  isComplete: boolean;
}

export interface AreaBuffer {
  key: string;
  name: string;
  configs: Map<string, ConfigBuffer>;
  configOrder: string[];
  isComplete: boolean;
}

export interface OpenState {
  area: string | null;
  config: string | null;
  testGroup: string | null;
  test: string | null;
}

export interface HierarchyPosition {
  area: string;
  config: string | null;
  testGroup: string | null;
  test: string | null;
}

export class BufferManager {
  private areas = new Map<string, AreaBuffer>();
  private areaOrder: string[] = [];

  private openState: OpenState = {
    area: null,
    config: null,
    testGroup: null,
    test: null,
  };

  private readonly FLUSH_DELAY_MS = 10;
  private emitCallback: ((line: string) => void) | null = null;

  constructor(emit?: (line: string) => void) {
    this.emitCallback = emit || null;
  }

  // ============================================================================
  // Hierarchy Management
  // ============================================================================

  addArea(key: string, name: string): void {
    if (!this.areas.has(key)) {
      this.areas.set(key, {
        key,
        name,
        configs: new Map(),
        configOrder: [],
        isComplete: false,
      });
      this.areaOrder.push(key);
    }
  }

  addConfig(areaKey: string, configKey: string, configName: string): void {
    const area = this.areas.get(areaKey);
    if (!area) return;

    if (!area.configs.has(configKey)) {
      area.configs.set(configKey, {
        key: configKey,
        name: configName,
        testGroups: new Map(),
        groupOrder: [],
        isComplete: false,
      });
      area.configOrder.push(configKey);
    }
  }

  addTestGroup(areaKey: string, configKey: string, groupKey: string, groupName: string): void {
    const config = this.getConfig(areaKey, configKey);
    if (!config) return;

    if (!config.testGroups.has(groupKey)) {
      config.testGroups.set(groupKey, {
        key: groupKey,
        name: groupName,
        tests: new Map(),
        testOrder: [],
        isComplete: false,
      });
      config.groupOrder.push(groupKey);
    }
  }

  addTest(
    areaKey: string,
    configKey: string,
    groupKey: string,
    testKey: string,
    testName: string,
  ): void {
    const group = this.getTestGroup(areaKey, configKey, groupKey);
    if (!group) return;

    if (!group.tests.has(testKey)) {
      group.tests.set(testKey, {
        key: testKey,
        name: testName,
        lines: [],
        status: null,
        hasOutput: false,
      });
      group.testOrder.push(testKey);
    }
  }

  // ============================================================================
  // Output Routing
  // ============================================================================

  /**
   * Route output - emit if on open path, buffer otherwise
   */
  routeOutput(position: HierarchyPosition, content: string): void {
    const onPath = this.isOnOpenPath(position);

    if (onPath) {
      this.emitImmediately(content);
      this.markHasOutput(position);
    } else {
      this.bufferOutput(position, content);
    }
  }

  /**
   * Check if a hierarchy position is on the current open path
   */
  private isOnOpenPath(position: HierarchyPosition): boolean {
    return (
      this.openState.area === position.area &&
      this.openState.config === position.config &&
      this.openState.testGroup === position.testGroup &&
      this.openState.test === position.test
    );
  }

  /**
   * Emit content immediately to console
   */
  private emitImmediately(content: string): void {
    if (this.emitCallback) {
      this.emitCallback(content);
    } else {
      // Fallback: use process.stdout to bypass Vitest intercept
      process.stdout.write(content + '\n');
    }
  }

  /**
   * Buffer content for later
   */
  private bufferOutput(position: HierarchyPosition, content: string): void {
    if (!position.test) return; // Can only buffer at test level

    const test = this.getTest(position.area, position.config!, position.testGroup!, position.test);
    if (!test) return;

    test.lines.push(content);
    test.hasOutput = true;
  }

  /**
   * Mark test as having output (public for direct routing)
   */
  markHasOutput(position: HierarchyPosition): void {
    if (!position.test) return;

    const test = this.getTest(position.area, position.config!, position.testGroup!, position.test);
    if (test) {
      test.hasOutput = true;
    }
  }

  // ============================================================================
  // Opening/Closing
  // ============================================================================

  async openArea(
    areaKey: string,
    emit: (line: string) => void,
    _cascadeOpen: boolean = true,
  ): Promise<void> {
    const area = this.areas.get(areaKey);
    if (!area) {
      return;
    }

    // Already open - nothing to do
    if (this.openState.area === areaKey) {
      return;
    }

    // Close current area if different (but don't cascade to next)
    if (this.openState.area && this.openState.area !== areaKey) {
      const _oldArea = this.openState.area;
      this.openState.area = null; // Clear before closing to prevent recursion
      // Don't cascade to next area here
    }

    this.openState.area = areaKey;
    this.openState.config = null;
    this.openState.testGroup = null;
    this.openState.test = null;

    // Emit area header
    emit('');
    emit('='.repeat(60));
    emit(`📦 Area: ${area.name}`);
    emit('='.repeat(60));

    // Open first config in this area (downward cascade)
    if (area.configOrder.length > 0) {
      await this.openConfig(areaKey, area.configOrder[0], emit, false);
    }
  }

  async openConfig(
    areaKey: string,
    configKey: string,
    emit: (line: string) => void,
    cascadeOpen: boolean = true,
  ): Promise<void> {
    const config = this.getConfig(areaKey, configKey);
    if (!config) {
      return;
    }

    // Already open - nothing to do
    if (this.openState.config === configKey && this.openState.area === areaKey) {
      return;
    }

    // Open parent hierarchy first (if needed)
    if (cascadeOpen) {
      await this.openArea(areaKey, emit, false);
    }

    // Close current config if different (but don't cascade to next)
    if (this.openState.config && this.openState.config !== configKey) {
      const _oldConfig = this.openState.config;
      this.openState.config = null; // Clear before closing to prevent recursion
      // Don't cascade to next config here
    }

    this.openState.config = configKey;
    this.openState.testGroup = null;
    this.openState.test = null;

    // Emit config header (if not 'none')
    if (configKey !== 'none') {
      emit('');
      emit(`  📋 Config: ${config.name}`);
    }

    // Open first test group in this config (downward cascade)
    if (config.groupOrder.length > 0) {
      await this.openTestGroup(areaKey, configKey, config.groupOrder[0], emit, false);
    }
  }

  async openTestGroup(
    areaKey: string,
    configKey: string,
    groupKey: string,
    emit: (line: string) => void,
    cascadeOpen: boolean = true,
  ): Promise<void> {
    const group = this.getTestGroup(areaKey, configKey, groupKey);
    if (!group) {
      return;
    }

    // Already open - nothing to do
    if (
      this.openState.testGroup === groupKey &&
      this.openState.config === configKey &&
      this.openState.area === areaKey
    ) {
      return;
    }

    // Open parent hierarchy first (if needed)
    if (cascadeOpen) {
      await this.openConfig(areaKey, configKey, emit, false);
    }

    // Close current test group if different (but don't cascade to next)
    if (this.openState.testGroup && this.openState.testGroup !== groupKey) {
      const _oldGroup = this.openState.testGroup;
      this.openState.testGroup = null; // Clear before closing to prevent recursion
      // Don't cascade to next group here
    }

    this.openState.testGroup = groupKey;
    this.openState.test = null;

    // Emit test group header
    emit('');
    emit(`    🧪 Test Group: ${group.name}`);

    // Open first test in this group (downward cascade)
    if (group.testOrder.length > 0) {
      await this.openTest(areaKey, configKey, groupKey, group.testOrder[0], emit, false);
    }
  }

  async openTest(
    areaKey: string,
    configKey: string,
    groupKey: string,
    testKey: string,
    emit: (line: string) => void,
    cascadeOpen: boolean = true,
  ): Promise<void> {
    const test = this.getTest(areaKey, configKey, groupKey, testKey);
    if (!test) {
      return;
    }

    // Already open - nothing to do
    if (
      this.openState.test === testKey &&
      this.openState.testGroup === groupKey &&
      this.openState.config === configKey &&
      this.openState.area === areaKey
    ) {
      return;
    }

    // Open parent hierarchy first (if needed)
    if (cascadeOpen) {
      await this.openTestGroup(areaKey, configKey, groupKey, emit, false);
    }

    // Close current test if different (but don't cascade to next)
    if (this.openState.test && this.openState.test !== testKey) {
      const _oldTest = this.openState.test;
      this.openState.test = null; // Clear before closing to prevent recursion
      // Don't cascade to next test here
    }

    this.openState.test = testKey;

    // Flush buffered lines progressively
    if (test.lines.length > 0) {
      await this.flushBufferedLines(test.lines, emit);
      test.lines = [];
    }
  }

  async closeTest(
    areaKey: string,
    configKey: string,
    groupKey: string,
    testKey: string,
    emit: (line: string) => void,
  ): Promise<void> {
    const test = this.getTest(areaKey, configKey, groupKey, testKey);
    if (!test) return;

    // Check if test completed without output
    if (!test.hasOutput && test.status) {
      emit(`      ⚠️  ${test.name} completed but did not provide any results to output`);
    }

    // Move to next test in group
    const group = this.getTestGroup(areaKey, configKey, groupKey);
    if (!group) return;

    const currentIndex = group.testOrder.indexOf(testKey);
    const nextIndex = currentIndex + 1;

    if (nextIndex < group.testOrder.length) {
      await this.openTest(areaKey, configKey, groupKey, group.testOrder[nextIndex], emit);
    } else {
      // Don't set group.isComplete here - let closeTestGroup handle it
      await this.closeTestGroup(areaKey, configKey, groupKey, emit);
    }
  }

  async closeTestGroup(
    areaKey: string,
    configKey: string,
    groupKey: string,
    emit: (line: string) => void,
  ): Promise<void> {
    const group = this.getTestGroup(areaKey, configKey, groupKey);
    if (!group || group.isComplete) return;

    // BEFORE closing the group, flush any buffered tests that never opened
    // This handles async tests that completed before the reporter reached them
    for (const testKey of group.testOrder) {
      const test = group.tests.get(testKey);
      if (test && test.lines.length > 0 && test.status) {
        // Test has buffered output and is complete - flush it now
        emit('');
        emit(`      ℹ️  ${test.name} (completed before display)`);
        for (const line of test.lines) {
          emit(`      ${line}`);
        }
        test.lines = []; // Clear buffer
      }
    }

    group.isComplete = true;

    emit('');
    emit(`    ✅ Test Group "${group.name}" complete`);

    const config = this.getConfig(areaKey, configKey);
    if (!config) return;

    const currentIndex = config.groupOrder.indexOf(groupKey);
    const nextIndex = currentIndex + 1;

    if (nextIndex < config.groupOrder.length) {
      await this.openTestGroup(areaKey, configKey, config.groupOrder[nextIndex], emit);
    } else {
      // Don't set config.isComplete here - let closeConfig handle it
      await this.closeConfig(areaKey, configKey, emit);
    }
  }

  async closeConfig(
    areaKey: string,
    configKey: string,
    emit: (line: string) => void,
  ): Promise<void> {
    const config = this.getConfig(areaKey, configKey);
    if (!config || config.isComplete) return;

    config.isComplete = true;

    if (configKey !== 'none') {
      emit('');
      emit(`  ✅ Config "${config.name}" complete`);
    }

    const area = this.areas.get(areaKey);
    if (!area) return;

    const currentIndex = area.configOrder.indexOf(configKey);
    const nextIndex = currentIndex + 1;

    if (nextIndex < area.configOrder.length) {
      await this.openConfig(areaKey, area.configOrder[nextIndex], emit);
    } else {
      // Don't set area.isComplete here - let closeArea handle it
      await this.closeArea(areaKey, emit);
    }
  }

  async closeArea(areaKey: string, emit: (line: string) => void): Promise<void> {
    const area = this.areas.get(areaKey);
    if (!area || area.isComplete) return;

    area.isComplete = true;

    emit('');
    emit('='.repeat(60));
    emit(`✅ Area "${area.name}" complete`);
    emit('='.repeat(60));

    if (this.openState.area === areaKey) {
      this.openState.area = null;
      this.openState.config = null;
      this.openState.testGroup = null;
      this.openState.test = null;
    }

    const currentIndex = this.areaOrder.indexOf(areaKey);
    const nextIndex = currentIndex + 1;

    if (nextIndex < this.areaOrder.length) {
      await this.openArea(this.areaOrder[nextIndex], emit);
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private async flushBufferedLines(lines: string[], emit: (line: string) => void): Promise<void> {
    for (const line of lines) {
      emit(line);
      await this.sleep(this.FLUSH_DELAY_MS);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getConfig(areaKey: string, configKey: string): ConfigBuffer | null {
    return this.areas.get(areaKey)?.configs.get(configKey) ?? null;
  }

  private getTestGroup(
    areaKey: string,
    configKey: string,
    groupKey: string,
  ): TestGroupBuffer | null {
    return this.areas.get(areaKey)?.configs.get(configKey)?.testGroups.get(groupKey) ?? null;
  }

  private getTest(
    areaKey: string,
    configKey: string,
    groupKey: string,
    testKey: string,
  ): TestBuffer | null {
    return (
      this.areas
        .get(areaKey)
        ?.configs.get(configKey)
        ?.testGroups.get(groupKey)
        ?.tests.get(testKey) ?? null
    );
  }

  /**
   * Set the status of a test
   */
  setTestStatus(
    areaKey: string,
    configKey: string,
    groupKey: string,
    testKey: string,
    status: 'pass' | 'fail' | 'skip',
  ): void {
    const test = this.getTest(areaKey, configKey, groupKey, testKey);
    if (test) {
      test.status = status;
    }
  }

  getOpenState(): Readonly<OpenState> {
    return { ...this.openState };
  }

  getAreaOrder(): readonly string[] {
    return [...this.areaOrder];
  }
}
