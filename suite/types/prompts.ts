// suite/types/prompts.ts

/** Base shape for a prompt */
export type PromptBase = {
  /** Case-insensitive regex source that should appear on screen */
  expect: string;
  /** Per-prompt timeout; default handled by runner */
  timeoutMs?: number;
};

/** Text prompt (“send” a line) */
export type PromptTextSpec = PromptBase & {
  /** Explicitly 'text' (optional to keep old JSONs working) */
  type?: 'text';
  /** What to send (usually ends with \n) */
  send: string;
};

/** Checkbox prompt (select multiple labels) */
export type PromptCheckboxSpec = PromptBase & {
  type: 'checkbox';
  /** Labels to select (as rendered) */
  labels: string[];
  /** Default true */
  required?: boolean;
  /** Default 200 */
  maxScroll?: number;
};

/** Union usable in tests.json (interactive.prompts) */
export type PromptSpec = PromptTextSpec | PromptCheckboxSpec;
