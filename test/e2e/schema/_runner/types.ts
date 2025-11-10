// test/e2e/schema/_runner/types.ts

/**
 * Schema test configuration file format.
 * Defines which files to validate against which schemas.
 */
export type SchemaConfigFile = {
  /** Optional description for the test suite */
  describe?: string;

  /** Optional default schema to use for all files (unless overridden per-file) */
  defaultSchema?: string;
  /**
   * Test groups containing schema checks.
   * Each group has a testGroupName and a tests mapping of testName -> { pattern, schema }.
   */
  schema: SchemaTestGroup[];
};

/**
 * A single file or glob pattern to validate.
 */
export type SchemaFileEntry = {
  /** Display name for test heading/output */
  name: string;

  /** File path or glob pattern (e.g., "fixtures/*.json" or "specific-file.json") */
  pattern: string;

  /** Optional schema override for this file/pattern (falls back to defaultSchema) */
  schema?: string;
};

/** New test group shape */
export type SchemaTestGroup = {
  /** Optional 'it' description for the group */
  it?: string;
  /** Logical test group name (used for grouping in the reporter) */
  testGroupName: string;
  /** Mapping of test name -> pattern/schema pair */
  tests: Record<string, { pattern: string; schema?: string }>;
};
