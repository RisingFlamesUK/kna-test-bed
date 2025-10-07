// suite/types/logger.ts

export type Logger = {
  filePath: string;
  step: (title: string, details?: string, indent?: number | string) => void;
  pass: (msg?: string, indent?: number | string) => void;
  warn: (msg: string, indent?: number | string) => void;
  fail: (msg: string, indent?: number | string) => void;
  write: (line: string, indent?: number | string) => void;
  /** Draw the top rule with a label, e.g. "┌─ generator output ─────" */
  boxStart: (title: string, opts?: { width?: number; indent?: number | string }) => void;
  /** Write a body line with "│ " prefix. Handles multi-line input. Empty line => "│" */
  boxLine: (line: string, opts?: { width?: number; indent?: number | string }) => void;
  /** Draw the bottom rule with a label, e.g. "└─ exit code: 0 ───────" */
  boxEnd: (
    label: string,
    opts?: { width?: number; indent?: number | string; suffix?: string },
  ) => void;
  close: () => Promise<void>;
};
