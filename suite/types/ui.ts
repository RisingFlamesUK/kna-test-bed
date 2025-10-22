// suite/types/ui.ts
import type { Sev } from './severity.ts';

// Central icon map for severities used across console, reporter, and logs
export const ICON: Record<Sev, string> = {
  ok: '✅',
  warn: '⚠️',
  fail: '❌',
  skip: '↩️',
};
