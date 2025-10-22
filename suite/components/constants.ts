// suite/components/constants.ts
export const KNA_LABEL: string = process.env.KNA_LABEL ?? 'kna-testbed=pg';
export const TMP_DIR_NAME: string = '.tmp'; // just the folder name
export const KNA_TMP_DIR: string = process.env.KNA_TMP_DIR || '';

// Standardized bullets for reporter and CI output
export const SUITE_BULLET = '• Testing Docker PG Environment...';
export const SCHEMA_BULLET = '• Validating prompt-map.json files...';
