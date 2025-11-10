// suite/reporter/core/ordering.ts

/**
 * Ordering Manager
 *
 * Manages test execution order based on:
 * 1. Area priority: Suite → Schema → Scenarios
 * 2. Running order JSON (future: stages, dependencies, parallel groups)
 *
 * For now, implements basic area ordering with hooks for future enhancement.
 */

export interface RunningOrderConfig {
  stages?: {
    name: string;
    parallel?: boolean;
    items: string[];
  }[];
}

export class OrderingManager {
  private areaOrderPriority = ['suite', 'schema', 'scenarios'];
  private runningOrder: RunningOrderConfig | null = null;

  /**
   * Set the running order configuration
   * (Future: load from running-order.json)
   */
  setRunningOrder(config: RunningOrderConfig): void {
    this.runningOrder = config;
  }

  /**
   * Get ordered list of areas based on priority
   */
  getOrderedAreas(collectedAreas: string[]): string[] {
    // For now: simple priority-based ordering
    // Future: integrate with running-order.json stages

    return collectedAreas.sort((a, b) => {
      const indexA = this.areaOrderPriority.indexOf(a);
      const indexB = this.areaOrderPriority.indexOf(b);

      const priorityA = indexA === -1 ? 999 : indexA;
      const priorityB = indexB === -1 ? 999 : indexB;

      return priorityA - priorityB;
    });
  }

  /**
   * Pre-initialize canonical areas to ensure correct ordering
   * even if Vitest collects them out of order
   */
  getCanonicalAreas(): Array<{ key: string; name: string }> {
    return [
      { key: 'suite', name: 'Suite' },
      { key: 'schema', name: 'Schema' },
    ];
  }

  /**
   * Determine if all required areas have been collected
   * (Used to decide when to start streaming)
   */
  hasRequiredAreas(collectedAreas: Set<string>): boolean {
    // Wait for Suite area at minimum (it should always run first)
    // Schema and Scenarios are optional depending on test run
    return collectedAreas.has('suite');
  }

  // ============================================================================
  // Future: Stage-based Ordering
  // ============================================================================

  /**
   * Get next item to open based on stage dependencies and completion
   * (Future implementation for running-order.json support)
   */
  getNextItem(): string | null {
    // TODO: Implement stage-aware ordering
    // - Track which stages are complete
    // - Determine next stage to open based on dependencies
    // - Handle parallel items within a stage (first defined opens, rest buffer)

    return null;
  }

  /**
   * Mark a stage or item as complete
   * (Future implementation for running-order.json support)
   */
  markComplete(_item: string): void {
    // TODO: Implement stage completion tracking
  }

  /**
   * Check if a stage's dependencies are satisfied
   * (Future implementation for running-order.json support)
   */
  canOpenStage(_stageName: string): boolean {
    // TODO: Check if all dependency stages are complete
    return true;
  }
}
