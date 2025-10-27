// test/components/interactive-driver.ts
import type { Logger } from '../../suite/types/logger.ts';
import { openBoxedProcess } from '../../suite/components/proc.ts';
import { PROMPT_TIMEOUT_MS, PROMPT_CHECKBOX_TIMEOUT_MS } from './test-constants.ts';

const KEY = {
  up: '\x1B[A',
  down: '\x1B[B',
  space: ' ',
  enter: '\n',
} as const;

export type TextPrompt = {
  /** Regex to detect the prompt in aggregated stdout */
  expect: RegExp;
  /** What to write to stdin (include '\n' as needed) */
  send: string;
  /** Per-prompt timeout (ms). Default 15000. */
  timeoutMs?: number;
  /** Discriminator not set or 'text' */
  type?: 'text';
};

export type CheckboxPrompt = {
  /** Regex to detect the *start* of the checkbox prompt area (e.g., /Select Passport strategies/i) */
  expect: RegExp;
  /** Labels to select (case-insensitive, trimmed). Driver will navigate and toggle each. */
  select: string[];
  /** If true (default), press ENTER after selections. Set false to keep menu open. */
  submit?: boolean;
  /** Per-prompt timeout (ms). Default 20000 for checkbox. */
  timeoutMs?: number;
  /** If true, throw if any requested label is not found by the end of a bounded scan. Default: false */
  required?: boolean;
  /** Maximum down-arrow scroll steps while scanning. Default: 2000 */
  maxScroll?: number;
  /** Discriminator */
  type: 'checkbox';
};

export type Prompt = TextPrompt | CheckboxPrompt;

export type RunInteractiveOpts = {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  prompts: Prompt[];
  logger?: Logger; // optional; if present, output is boxed via logger
  logTitle?: string; // default "generator output"
  windowsHide?: boolean; // default true (forwarded)
};

export type RunInteractiveResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOutAt?: number; // index of prompt that timed out (if any)
};

export async function runInteractive(opts: RunInteractiveOpts): Promise<RunInteractiveResult> {
  const {
    cmd,
    args = [],
    cwd,
    env,
    prompts,
    logger,
    logTitle = 'generator output',
    windowsHide = true,
  } = opts;

  const { proc, closeBox } = openBoxedProcess(logger, cmd, args, {
    title: logTitle,
    cwd,
    env,
    windowsHide,
  });

  let outBuf = '';
  let errBuf = '';

  const captureStdout = (chunk: any) => {
    outBuf += String(chunk);
  };
  const captureStderr = (chunk: any) => {
    errBuf += String(chunk);
  };

  proc.stdout?.on('data', captureStdout);
  proc.stderr?.on('data', captureStderr);

  // Track diagnostics for transparency on timeouts
  const matchedSummaries: string[] = []; // "Text: /.../ → <sent>"  or  "Checkbox: /.../ → [a, b]"

  // Wait until `pattern` appears in outBuf, or timeout.
  const waitFor = (pattern: RegExp, timeoutMs: number) =>
    new Promise<void>((resolve, reject) => {
      if (pattern.test(outBuf)) return resolve();
      const onData = () => {
        if (pattern.test(outBuf)) {
          clear();
          resolve();
        }
      };
      const clear = () => {
        proc.stdout?.off('data', onData);
        proc.stderr?.off('data', onData);
        clearTimeout(timer);
      };
      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);
      const timer = setTimeout(() => {
        clear();
        const preview = outBuf.slice(-500); // last 500 chars for context
        reject(
          new Error(
            `Timeout (${timeoutMs}ms) waiting for pattern: ${pattern}\n` +
              `Last output (500 chars):\n${preview}\n` +
              `Prompts processed before timeout: ${matchedSummaries.length}`,
          ),
        );
      }, timeoutMs);
    });

  // Parse the tail of outBuf to extract a checkbox menu snapshot.
  // Returns list items with `focused` (❯) and `selected` (◉ / [x]) flags.
  function parseCheckboxSnapshot(): {
    items: { label: string; focused: boolean; selected: boolean }[];
    focusedIndex: number;
  } {
    const tail = outBuf.split(/\r?\n/).slice(-60); // last 60 lines is plenty for typical menus
    const items: { label: string; focused: boolean; selected: boolean }[] = [];
    let focusedIndex = -1;

    const lineRe =
      /^(?<indent>\s*)(?<cursor>❯|>|)?\s*(?<mark>\[[ xX]\]|[◯◉○●•⭘⦿])\s*(?<label>.+?)\s*$/u;

    for (const line of tail) {
      const m = lineRe.exec(stripAnsi(line));
      if (!m) continue;
      const cursor = !!m.groups?.cursor;
      const mark = (m.groups?.mark ?? '').trim();
      const label = (m.groups?.label ?? '').trim();

      const selected = mark === '[x]' || mark === '[X]' || /[◉●⦿]/u.test(mark);
      const focused = cursor;
      if (focused) focusedIndex = items.length;
      items.push({ label, focused, selected });
    }

    return { items, focusedIndex };
  }

  function stripAnsi(s: string): string {
    // Basic ANSI escape removal
    return s.replace(
      // eslint-disable-next-line no-control-regex
      /\x1B\[[0-9;?]*[ -/]*[@-~]/g,
      '',
    );
  }

  async function handleTextPrompt(p: TextPrompt) {
    const timeout = p.timeoutMs ?? PROMPT_TIMEOUT_MS;
    await waitFor(p.expect, timeout);
    matchedSummaries.push(`Text    : ${String(p.expect)} → ${JSON.stringify(p.send)}`);
    proc.stdin?.write(p.send);
  }

  async function handleCheckboxPrompt(p: CheckboxPrompt) {
    const timeout = p.timeoutMs ?? PROMPT_CHECKBOX_TIMEOUT_MS;
    await waitFor(p.expect, timeout);

    const targets = p.select.map((s) => s.trim().toLowerCase());
    const selectedTargets = new Set<string>();
    const seenLabels = new Set<string>();

    const maxScroll = Math.max(1, p.maxScroll ?? 2000);

    // Helper: navigate from current focus to target index
    async function moveCursorTo(targetIndex: number, currentFocused: number) {
      let cursor = currentFocused >= 0 ? currentFocused : 0;
      while (cursor < targetIndex) {
        proc.stdin?.write(KEY.down);
        cursor++;
        await new Promise((r) => setTimeout(r, 8));
      }
      while (cursor > targetIndex) {
        proc.stdin?.write(KEY.up);
        cursor--;
        await new Promise((r) => setTimeout(r, 8));
      }
    }

    // Scan through the list, selecting targets as they appear.
    let steps = 0;
    while (steps < maxScroll && selectedTargets.size < targets.length) {
      // Parse current window
      const { items, focusedIndex } = parseCheckboxSnapshot();

      // Track everything we can see
      for (const it of items) {
        seenLabels.add(it.label.trim().toLowerCase());
      }

      // If we can see any remaining target, select it now
      let acted = false;
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const key = it.label.trim().toLowerCase();
        if (!targets.includes(key) || selectedTargets.has(key)) continue;

        // Move to it if needed
        await moveCursorTo(idx, focusedIndex);

        // Re-parse to confirm focus/selection state
        await new Promise((r) => setTimeout(r, 24));
        const snap2 = parseCheckboxSnapshot();
        const item2 = snap2.items[idx];
        if (!item2) continue;

        // Toggle only if not selected yet
        if (!item2.selected) {
          proc.stdin?.write(KEY.space);
          await new Promise((r) => setTimeout(r, 24));
        }

        selectedTargets.add(key);
        acted = true;
        // Continue loop; if more targets visible, we’ll take them in subsequent iterations
      }

      if (selectedTargets.size >= targets.length) break;

      // If we didn't act this iteration, advance the viewport (scroll down by one)
      if (!acted) {
        proc.stdin?.write(KEY.down);
        steps++;
        await new Promise((r) => setTimeout(r, 12));
      }
    }

    // If some targets weren’t found after scanning:
    const missing = targets.filter((t) => !selectedTargets.has(t));
    if (missing.length > 0 && p.required) {
      throw new Error(
        `Checkbox selection failed — missing labels after scan: ${missing.join(
          ', ',
        )}. Seen labels: ${Array.from(seenLabels).join(', ')}`,
      );
    }

    matchedSummaries.push(`Checkbox: ${String(p.expect)} → [${p.select.join(', ')}]`);

    // Optionally submit the selection
    if (p.submit !== false) {
      proc.stdin?.write(KEY.enter);
    }
  }

  // Run prompts in order
  let timedOutAt: number | undefined;
  for (let i = 0; i < prompts.length; i++) {
    try {
      const p = prompts[i];
      if ((p as any).type === 'checkbox') {
        await handleCheckboxPrompt(p as any);
      } else {
        await handleTextPrompt(p as any);
      }
    } catch {
      timedOutAt = i;
      break;
    }
  }

  // Diagnostics on timeout
  if (typeof timedOutAt === 'number' && logger) {
    const expectedNotSeen = prompts
      .slice(timedOutAt)
      .map((p, idx) => `#${timedOutAt + idx + 1}: ${String((p as any).expect)}`);

    // Heuristic: lines that look like Inquirer/Prompts (start with '?')
    const questionLines = Array.from(
      new Set(
        outBuf
          .split(/\r?\n/)
          .map(stripAnsi)
          .filter((l) => /^\s*\?\s/.test(l)),
      ),
    );

    // Anything in questionLines that doesn't match any expected regex
    const unmatchedSeen = questionLines.filter(
      (line) =>
        !prompts.some((p) => (p as any).expect instanceof RegExp && (p as any).expect.test(line)),
    );

    logger.write('Prompts expected and responded to:');
    for (const line of matchedSummaries) logger.write('  - ' + line);

    logger.write('Prompts seen but not expected:');
    for (const line of unmatchedSeen) logger.write('  - ' + line);

    logger.write('Prompts expected but not seen:');
    for (const line of expectedNotSeen) logger.write('  - ' + line);

    logger.fail('❌ Scaffold-command-assert timed out.');
  }

  const { exitCode } = await proc.wait();
  closeBox(exitCode);

  return { stdout: outBuf, stderr: errBuf, exitCode, timedOutAt };
}
