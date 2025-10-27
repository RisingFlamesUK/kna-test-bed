// suite/components/constants.ts
export const KNA_LABEL: string = process.env.KNA_LABEL ?? 'kna-testbed=pg';
export const TMP_DIR_NAME: string = '.tmp'; // just the folder name
export const KNA_TMP_DIR: string = process.env.KNA_TMP_DIR || '';

// Standardized bullets for reporter and CI output
export const SUITE_BULLET = '• Testing Docker PG Environment...';
export const SCHEMA_BULLET = '• Validating schema files...';

// JSON artifact filenames (used across reporter, detail-io, global-setup)
export const SUITE_DETAIL_FILE = '_suite-detail.json';
export const SCHEMA_DETAIL_FILE = '_schema-detail.json';
export const SCENARIO_DETAIL_FILE = '_scenario-detail.json';
export const VITEST_SUMMARY_FILE = '_vitest-summary.json';

// Log filenames
export const SUITE_LOG_FILE = 'suite-sentinel.log';
export const SCHEMA_LOG_FILE = 'schema-validation.log';

// Test file path patterns (regex for test detection)
export const SUITE_TEST_PATTERN = /test\/e2e(?:\/suite)?\/suite\.test\.ts$/i;
export const SCHEMA_TEST_PATTERN = /test\/e2e\/schema\/schema-validation\.test\.ts$/i;
export const SCENARIO_TEST_PATTERN = /test\/e2e\/scenarios\/(?!_runner\/).+\/.+\.test\.ts$/i;

// Directory path segments
export const LOGS_DIR = 'logs';
export const E2E_DIR = 'e2e';
export const TEST_E2E_DIR = 'test/e2e';
export const SCHEMA_CONFIG_DIR = 'test/e2e/schema/config';
export const SCHEMA_FIXTURES_DIR = 'test/e2e/schema/fixtures';

// Environment variable names
export const ENV_LOG_STAMP = 'KNA_LOG_STAMP';
export const ENV_PRE_RELEASE_VERSION = 'PRE_RELEASE_VERSION';
export const ENV_SCENARIO_CONFIG = 'SCENARIO_CONFIG';

// Default/fallback paths
export const DEFAULT_PROMPT_MAP = 'test/e2e/schema/fixtures/prompt-map-valid.json';
