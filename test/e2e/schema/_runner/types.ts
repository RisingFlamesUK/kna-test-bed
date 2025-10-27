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

  /** List of file entries to validate */
  files: SchemaFileEntry[];
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
