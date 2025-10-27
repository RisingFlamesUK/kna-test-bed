// test/components/test-constants.ts

/**
 * Test timeout constants used across e2e test infrastructure
 */

// Per-prompt timeouts (interactive driver)
export const PROMPT_TIMEOUT_MS = 15_000; // 15 seconds - default for text/confirm prompts
export const PROMPT_CHECKBOX_TIMEOUT_MS = 20_000; // 20 seconds - longer for checkbox menus

// Test-level timeouts (Vitest test(..., timeout))
export const SCHEMA_TEST_TIMEOUT_MS = 60_000; // 1 minute - schema validation with ajv-cli
export const SCENARIO_TEST_TIMEOUT_MS = 180_000; // 3 minutes - scenario tests with interactive prompts
