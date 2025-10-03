// suite/components/logger.ts
import path from 'path';

import fs from 'fs-extra';

export type Logger = {
  filePath: string;
  step: (title: string, details?: string, indent?: number | string) => void;
  pass: (msg?: string, indent?: number | string) => void;
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

function _indentToString(ind?: number | string): string {
  if (ind == null) return '';
  if (typeof ind === 'number') return ' '.repeat(Math.max(0, ind));
  return ind; // pass-through for custom prefixes (e.g., "│ ")
}

/**
 * Return a shallow "view" of a logger that automatically prefixes all writes
 * (write/pass/fail and step details) with the given indent.
 * Step headers remain left-justified; only step *details* are indented.
 */
export function withIndent(base: Logger, indent: number | string): Logger {
  // Keep behavior consistent with the rest of the logger:
  // numbers => absolute spaces, "+n"/"-n" => relative, any other string => literal prefix.
  // We pass this through to all calls as the default indent unless the caller overrides.
  const pad = _indentToString(indent);

  return {
    filePath: base.filePath,

    // Step header stays left-justified in base.step; only the *details* use indent.
    step: (title, details, _ind) => base.step(title, details, _ind ?? pad),

    // Success/failure/write with default indent applied unless caller overrides.
    pass: (msg, _ind) => base.pass(msg, _ind ?? pad),
    fail: (msg, _ind) => base.fail(msg, _ind ?? pad),
    write: (line, _ind) => base.write(line, _ind ?? pad),

    // Boxed sections: keep width & suffix passthrough, apply default indent unless overridden.
    boxStart: (title, opts) =>
      base.boxStart(title, { width: opts?.width, indent: opts?.indent ?? pad }),

    boxLine: (line, opts) =>
      base.boxLine(line, { width: opts?.width, indent: opts?.indent ?? pad }),

    boxEnd: (label, opts) =>
      base.boxEnd(label, {
        width: opts?.width,
        indent: opts?.indent ?? pad,
        suffix: opts?.suffix,
      }),

    close: () => base.close(),
  };
}

// Interpret indent with a fallback and modifiers:
// - undefined  → use fallback
// - number     → absolute spaces
// - string "+n"/"-n" → relative to fallback length
// - any other string → literal prefix (e.g. "│ ")
function _resolveIndent(ind: number | string | undefined, fallback: string): string {
  if (ind === undefined) return fallback;

  if (typeof ind === 'number') {
    return ' '.repeat(Math.max(0, ind));
  }

  const m = ind.match(/^([+-])(\d+)$/);
  if (m) {
    const sign = m[1] === '+' ? 1 : -1;
    const delta = parseInt(m[2], 10);
    const base = fallback.length;
    const next = Math.max(0, base + sign * delta);
    return ' '.repeat(next);
  }

  // Treat as literal prefix
  return ind;
}

/** Default box width (characters), including the left glyph and padding. */
const DEFAULT_BOX_WIDTH = 78;
/** Default box indent. */
const DEFAULT_BOX_IND = '      ';

function _fitLabel(label: string, maxLen: number): string {
  // Truncate without ellipsis to keep scans clean.
  return label.length <= maxLen ? label : label.slice(0, maxLen);
}

function _makeRule(openGlyph: '┌' | '└', label: string, width: number): string {
  const head = `${openGlyph}─ `;
  const usable = Math.max(0, width - head.length);
  const text = _fitLabel(label, usable);
  const dashes = Math.max(0, usable - text.length);
  return head + text + '─'.repeat(dashes);
}

/** Suggested default for “step detail” indent. */
export const STEP_DETAIL_INDENT = 4;

export function createLogger(filePath: string): Logger {
  let counter = 0;
  fs.ensureDirSync(path.dirname(filePath));
  const stream = fs.createWriteStream(filePath, { flags: 'a' });

  const append = (line: string) => {
    stream.write(line.endsWith('\n') ? line : line + '\n', 'utf8');
  };

  // Normalize indent: if caller didn't provide one, use a fallback.
  // For step details / pass / fail we keep the legacy "   " default
  // so existing call-sites render exactly as before.
  function _normIndent(ind?: number | string, fallback = ''): string {
    return ind === undefined ? fallback : _indentToString(ind);
  }

  const step = (title: string, details = '', indent?: number | string) => {
    counter += 1;
    append(`${counter}) ${title}`); // header stays left-justified
    if (details) append(`${_resolveIndent(indent, '   ')}${details}`); // default 3 for step details
  };

  const pass = (msg = 'PASS', indent?: number | string) =>
    append(`${_resolveIndent(indent, '   ')}✅ ${msg}`); // default 3

  const fail = (msg: string, indent?: number | string) =>
    append(`${_resolveIndent(indent, '   ')}❌ ${msg}`); // default 3

  const write = (line: string, indent?: number | string) =>
    append(`${_resolveIndent(indent, '    ')}${line}`); // default 4 for plain writes

  const boxStart: Logger['boxStart'] = (title, opts) => {
    const width = opts?.width ?? DEFAULT_BOX_WIDTH;
    const ind = _resolveIndent(opts?.indent, DEFAULT_BOX_IND);
    append(ind + _makeRule('┌', title, width));
  };

  const boxLine: Logger['boxLine'] = (line, opts) => {
    const ind = _resolveIndent(opts?.indent, DEFAULT_BOX_IND);
    const width = opts?.width ?? DEFAULT_BOX_WIDTH;
    const contentWidth = Math.max(0, width - 2); // "│ " prefix
    const emit = (s: string) => append(ind + '│ ' + s);

    if (!line) {
      append(ind + '│');
      return;
    }

    const logicalLines = line.replace(/\r\n/g, '\n').split('\n');
    for (const l of logicalLines) {
      if (l.length <= contentWidth) {
        emit(l);
      } else {
        // hard wrap; no hyphenation
        let i = 0;
        while (i < l.length) {
          emit(l.slice(i, i + contentWidth));
          i += contentWidth;
        }
      }
    }
  };

  const boxEnd: Logger['boxEnd'] = (label, opts) => {
    const width = opts?.width ?? DEFAULT_BOX_WIDTH;
    const ind = _resolveIndent(opts?.indent, DEFAULT_BOX_IND);
    const full = opts?.suffix ? `${label} ${opts.suffix}` : label;
    append(ind + _makeRule('└', full, width));
  };

  const close = () =>
    new Promise<void>((resolve) => {
      stream.end(resolve);
    });

  return {
    filePath,
    step,
    pass,
    fail,
    write,
    boxStart,
    boxLine,
    boxEnd,
    close,
  };
}

// Optional helper: generate a run stamp (e.g. 2025-09-30T09-45-12-345Z)
export function makeLogStamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-');
}

// Sanitize scenario names into safe filenames.
export function sanitizeLogName(name: string): string {
  return name.replace(/[^\w.+-]/g, '_');
}

// logs/<stamp>
export function buildLogRoot(stamp: string): string {
  return path.join('logs', stamp);
}

// logs/<stamp>/suite.log
export function buildSuiteLogPath(stamp: string): string {
  return path.join(buildLogRoot(stamp), 'suite.log');
}

// logs/<stamp>/e2e/<scenario>.log
export function buildScenarioLogPath(stamp: string, scenario: string): string {
  return path.join(buildLogRoot(stamp), 'e2e', `${sanitizeLogName(scenario)}.log`);
}

// Convenience: create a scenario logger using KNA_LOG_STAMP from env.
// Throws if global-setup hasn't set the stamp.
export function scenarioLoggerFromEnv(scenario: string) {
  const stamp = process.env.KNA_LOG_STAMP;
  if (!stamp) {
    throw new Error('KNA_LOG_STAMP missing — global-setup must set it before tests run.');
  }
  const p = buildScenarioLogPath(stamp, scenario);
  fs.ensureDirSync(path.dirname(p));
  return createLogger(p);
}
