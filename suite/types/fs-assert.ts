// suite/types/fs-assert.ts
import type { Logger } from '../types/logger.ts';

export type AssertFilesManifestV1 = {
  /** Paths/globs that must exist (each pattern must match >= 1 entry) */
  required?: string[];
  /** Paths/globs that must NOT exist */
  forbidden?: string[];
  /** Paths/globs to skip entirely (not counted, not reported) */
  ignore?: string[];
};

export type AssertFilesOptions = {
  cwd: string; // scenario sandbox root (absolute)
  manifest: AssertFilesManifestV1; // parsed JSON manifest
  logger: Logger; // suite logger
  /** Optional label/path for logging (so runner doesn't need a separate step) */
  manifestLabel?: string; // printed in the header for clarity
  scenarioName?: string; // used for per-scenario severity sentinel
};
