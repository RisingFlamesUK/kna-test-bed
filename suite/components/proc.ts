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

export type OpenBoxedOpts = {
  title?: string; // Box title, default "process"
  windowsHide?: boolean; // default true
  cwd?: string;
  env?: Record<string, string | undefined>;
};

/**
 * Represents a running process (minimal wrapper around execa).
 */
export type RunningProc = {
  stdin: NodeJS.WritableStream | null | undefined;
  stdout: NodeJS.ReadableStream | null | undefined;
  stderr: NodeJS.ReadableStream | null | undefined;
  wait: () => Promise<{ exitCode: number }>;
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

/**
 * openBoxedProcess — spawn a process and (optionally) stream output into a logger box.
 * - If `log` is provided, opens the box on first output and writes each line; closes with footer.
 * - Returns a minimal RunningProc so callers can drive stdin and await completion.
 */
export function openBoxedProcess(
  log: Logger | undefined,
  cmd: string,
  args: string[] = [],
  opts: OpenBoxedOpts = {},
): {
  proc: RunningProc;
  closeBox: (exitCode: number) => void;
} {
  const { title = 'process', windowsHide = true, cwd, env } = opts;

  let opened = false;
  const openBoxIfNeeded = () => {
    if (!log || opened) return;
    log.boxStart(title);
    opened = true;
  };

  const child = execa(cmd, args, {
    cwd,
    env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide,
  });

  const stripAnsi = (s: string) =>
    // Basic ANSI escape removal (CSI + some OSC/SS2/SS3 variants)
    s.replace(
      // eslint-disable-next-line no-control-regex
      /\x1B[@-Z\\-_]|\x1B\[[0-?]*[ -/]*[@-~]|\x9B[0-?]*[ -/]*[@-~]|\x1B\][^\x07]*(?:\x07|\x1B\\)/g,
      '',
    );

  const onChunk = (chunk: any) => {
    if (!log) return;
    openBoxIfNeeded();
    const s = stripAnsi(String(chunk));

    // Split and drop only a final empty fragment (so repaint bursts don’t spam blanks)
    const lines = s.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const isLast = i === lines.length - 1;
      const line = lines[i];
      if (isLast && line === '') continue;
      log.boxLine(line);
    }
  };

  child.stdout?.on('data', onChunk);
  child.stderr?.on('data', onChunk);

  const closeBox = (exitCode: number) => {
    if (log && opened) log.boxEnd(`exit code: ${exitCode}`);
  };

  const proc: RunningProc = {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    wait: async () => {
      try {
        const { exitCode } = await child;
        return { exitCode: exitCode ?? 0 };
      } catch (e: any) {
        const code = typeof e?.exitCode === 'number' ? e.exitCode : 1;
        return { exitCode: code };
      }
    },
  };

  return { proc, closeBox };
}

/**
 * Write a simple boxed section to the logger.
 * - `lines`: main content lines
 * - `legend`: optional lines appended after a spacer
 * - `width`: optional hard cap (default 120)
 */
export function logBox(
  log: Logger | undefined,
  title: string,
  lines: string[],
  legend?: string[],
  width = 120,
): void {
  if (!log) return;

  const contentWidths = [
    title.length + 2,
    ...lines.map((l) => l.length),
    ...(legend ?? []).map((l) => l.length),
  ];
  const w = Math.min(width, Math.max(...contentWidths) + 2);

  const top = `┌─ ${title}${'─'.repeat(Math.max(1, w - (title.length + 2)))}`;
  log.write(top);
  for (const l of lines) log.write('│ ' + l);
  if (legend && legend.length) {
    log.write('│'); // spacer
    for (const l of legend) log.write('│ ' + l);
  }
  const bottom = `└─ ${'─'.repeat(Math.max(1, w - 2))}`;
  log.write(bottom);
}
