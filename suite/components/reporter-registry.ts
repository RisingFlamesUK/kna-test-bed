// suite/components/reporter-registry.ts

import type { CI } from '../types/ci.ts';

/**
 * Reporter Registry (Singleton)
 *
 * Provides global access to the active reporter for CI instance creation.
 * Note: This only works within the main thread, not across Vitest worker threads.
 */

interface ReporterCIProvider {
  getCIForTask(taskId: string): CI;
  getCI(): CI;
  routeOutput(taskId: string | undefined, content: string): void;
}

let activeReporter: ReporterCIProvider | null = null;

/**
 * Register the active reporter
 * (Called by the reporter during initialization)
 */
export function registerReporter(reporter: ReporterCIProvider): void {
  activeReporter = reporter;
}

/**
 * Get a CI instance, routing through active reporter if available
 * NOT CURRENTLY USED - kept for compatibility
 */
export function getReporterCI(taskId?: string): CI | undefined {
  if (activeReporter) {
    return taskId ? activeReporter.getCIForTask(taskId) : activeReporter.getCI();
  }
  return undefined;
}

/**
 * Check if a reporter is currently active
 */
export function hasActiveReporter(): boolean {
  return activeReporter !== null;
}

/**
 * Clear the active reporter
 * (Called during teardown)
 */
export function clearReporter(): void {
  activeReporter = null;
}
