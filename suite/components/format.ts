// suite/components/format.ts
// Shared, pure formatting helpers reused by ci.ts and logger.ts

/** Default box width (characters), including the left glyph and padding. */
export const DEFAULT_BOX_WIDTH = 78;

/** Truncate without ellipsis to keep scans clean. */
export function fitLabel(label: string, maxLen: number): string {
  return label.length <= maxLen ? label : label.slice(0, maxLen);
}

export function makeRule(openGlyph: '┌' | '└', label: string, width: number): string {
  const head = `${openGlyph}─ `;
  const usable = Math.max(0, width - head.length);
  const text = fitLabel(label, usable);
  const dashes = Math.max(0, usable - text.length);
  return head + text + '─'.repeat(dashes);
}

/** Resolve an indent value (string or number) with a default */
export function resolveIndent(indent: string | number | undefined, defaultIndent: string): string {
  if (indent == null) return defaultIndent;
  return typeof indent === 'number' ? ' '.repeat(indent) : indent;
}
