// suite/components/proc.ts
import { execa, type Options as ExecaOptions } from 'execa';

import type { Logger } from './logger.ts';

export type SimpleExec = { stdout: string; exitCode: number };
export type ExecBoxedOptions = ExecaOptions & {
  title?: string; // boxStart title
  markStderr?: boolean; // prefix stderr lines with "! "
  windowsHide?: boolean; // default true on Windows
  argsWrapWidth?: number; // optional: wrap args if JSON length > width
};

function writeArgs(log: Logger | undefined, args: string[], argsWrapWidth?: number) {
  const single = JSON.stringify(args);
  if (!argsWrapWidth || single.length <= argsWrapWidth) {
    // One-liner fits → keep compact
    log?.write?.(`args=${single}`);
    return;
  }

  // Multi-line: pack as many tokens per line as fit within argsWrapWidth.
  const tokens = args.map((a) => JSON.stringify(a));
  const lines: string[] = [];
  let current = '';

  for (const tok of tokens) {
    if (current.length === 0) {
      current = tok;
    } else if (current.length + 2 + tok.length <= argsWrapWidth) {
      current += `, ${tok}`;
    } else {
      lines.push(current);
      current = tok;
    }
  }
  if (current) lines.push(current);

  log?.write?.('args=[');
  for (let i = 0; i < lines.length; i++) {
    const isLast = i === lines.length - 1;
    // indent inner lines +2 relative to the logger’s default indent
    log?.write?.(`  ${lines[i]}${isLast ? '' : ','}`, '+2');
  }
  log?.write?.(']');
}

/**
 * Write cmd/args lines, then run the process.
 * Opens a box only when the first chunk of output arrives.
 * Returns the execa result.
 */
export async function execBoxed(
  log: Logger | undefined,
  cmd: string,
  args: string[],
  opts: ExecBoxedOptions = {},
): Promise<SimpleExec> {
  const {
    title = 'process output',
    markStderr = true,
    windowsHide = true,
    argsWrapWidth,
    ...execaOpts
  } = opts;

  log?.write?.(`cmd=${cmd}`);
  writeArgs(log, args, argsWrapWidth);

  // Force string stdout via encoding: 'utf8'
  const child = execa(cmd, args, {
    windowsHide,
    encoding: 'utf8',
    ...execaOpts,
  });

  let opened = false;
  const open = () => {
    if (!opened) {
      log?.boxStart?.(title);
      opened = true;
    }
  };

  child.stdout?.on('data', (buf: Buffer) => {
    const s = buf.toString('utf8');
    if (!s) return;
    open();
    for (const line of s.replace(/\r\n/g, '\n').split('\n')) {
      if (line) log?.boxLine?.(line);
    }
  });

  child.stderr?.on('data', (buf: Buffer) => {
    const s = buf.toString('utf8');
    if (!s) return;
    open();
    for (const line of s.replace(/\r\n/g, '\n').split('\n')) {
      if (!line) continue;
      log?.boxLine?.(markStderr ? `! ${line}` : line);
    }
  });

  const result = await child;

  if (opened) log?.boxEnd?.(`exit code: ${result.exitCode}`);

  // Guarantee a string `stdout` to callers
  const out = typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? '');
  return { stdout: out, exitCode: result.exitCode ?? 0 };
}
