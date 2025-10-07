// test/components/scaffold-command-assert.ts
import path from 'node:path';

import fs from 'fs-extra';
import { execa } from 'execa';

import { TMP_DIR_NAME, KNA_TMP_DIR } from '../../suite/components/constants.ts';
import {
  scenarioLoggerFromEnv,
  sanitizeLogName,
  makeLogStamp,
} from '../../suite/components/logger.ts';
import { type Logger } from '../../suite/types/logger.ts';
import { execBoxed } from '../../suite/components/proc.ts';
import { runInteractive, Prompt } from './interactive-driver.ts';

export type ScaffoldCmdOpts = {
  scenarioName: string; // e.g. "local-only"
  flags: string[]; // raw CLI flags (ignored when answersFile is provided)
  answersFile?: string; // path to answers JSON (when provided, flags are ignored)
  keepArtifacts?: boolean; // default false
  log?: Logger; // optional: pass an existing logger to continue numbering across components
  subcommand?: string; // default "web" (future-proof)
  interactive?: {
    prompts: Prompt[];
    transcriptPath?: string;
  };
  generator?:
    | { kind: 'linked'; spec: string } // default: { kind: "linked", spec: "kickstart-node-app" }
    | { kind: 'node'; entry: string } // local dev entry file, e.g. "./packages/cli/bin/cli.js"
    | { kind: 'npx'; spec: string }; // e.g. "kickstart-node-app@latest" or "kickstart-node-app@1.2.3"
};

export type ScaffoldResult = {
  appDir: string; // absolute path to the generated app
  logPath: string; // logs/<stamp>/e2e/<scenario>.log
  log: Logger; // same logger instance (for continuous step numbering)
  cleanup: () => Promise<void>; // removes appDir unless keepArtifacts === true
};

// Unique folder per run; safe and readable
function generateAppName(scenarioName: string): string {
  return `${makeLogStamp()}-${sanitizeLogName(scenarioName)}`;
}

export async function assertScaffoldCommand(opts: ScaffoldCmdOpts): Promise<ScaffoldResult> {
  const log = opts.log ?? scenarioLoggerFromEnv(opts.scenarioName);
  console.log('[SCENARIO_LOG]', log.filePath);

  // 1) Resolve temp root and ensure it exists
  const tmpRoot = KNA_TMP_DIR
    ? path.resolve(process.cwd(), KNA_TMP_DIR)
    : path.join(process.cwd(), TMP_DIR_NAME);
  await fs.ensureDir(tmpRoot);

  // 2) Determine app dir (must not exist)
  const appName = generateAppName(opts.scenarioName);
  const appDir = path.join(tmpRoot, appName);

  log.step(`Scaffold: preparing temp app directory`);
  log.write(`tmpRoot=${tmpRoot}`);
  log.write(`appDir=${appDir}`);

  if (await fs.pathExists(appDir)) {
    log.fail(`Target path already exists: ${appDir}`);
    throw new Error(`Refusing to scaffold into existing path: ${appDir}`);
  }

  // 3) Build command + args
  const generator = opts.generator ?? ({ kind: 'linked', spec: 'kickstart-node-app' } as const);
  const subcommand = opts.subcommand ?? 'web';

  let cmd = '';
  const args: string[] = [];

  // Policy: if answersFile is provided, ignore all flags and pass ONLY --answers-file
  const flagsByPolicy: string[] = opts.answersFile ? [] : [...(opts.flags ?? [])];

  switch (generator.kind) {
    case 'linked': {
      cmd = generator.spec; // on PATH (linked dev install)
      args.push(subcommand, appDir, ...flagsByPolicy);
      break;
    }
    case 'node': {
      cmd = 'node';
      args.push(generator.entry, subcommand, appDir, ...flagsByPolicy);
      break;
    }
    case 'npx': {
      cmd = 'npx';
      args.push(generator.spec, subcommand, appDir, ...flagsByPolicy);
      break;
    }
  }

  // Append --answers-file if provided (absolute path)
  if (opts.answersFile) {
    const absAnswers = path.resolve(process.cwd(), opts.answersFile);
    args.push('--answers-file', absAnswers);
  }

  // Log the exact invocation for reproducibility
  log.step(`Scaffold: invoking generator`);
  log.write(`cmd=${cmd}`);
  log.write(`args=${JSON.stringify(args)}`);
  log.write(`cwd=${process.cwd()}`);

  // 4) IO mode: interactive vs silent/answers
  // Interactive when: no answers file AND flags do not include --silent
  const isSilent = flagsByPolicy.includes('--silent');
  const isInteractive = !opts.answersFile && !isSilent;

  // 5) Run the process
  try {
    if (isInteractive) {
      if (opts.interactive?.prompts?.length) {
        // Programmatic interactive run (CI-friendly): use the driver
        await runInteractive({
          cmd,
          args,
          cwd: process.cwd(),
          env: process.env as Record<string, string | undefined>,
          prompts: opts.interactive.prompts,
          logger: log,
          logTitle: 'generator output',
          windowsHide: true,
        });
      } else {
        // Manual interactive (visible in local terminal)
        log.write('(interactive/manual) streaming to terminal (no prompts provided)');
        await execa(cmd, args, { cwd: process.cwd(), stdio: 'inherit' });
      }
    } else {
      // Non-interactive / answers-file / --silent
      await execBoxed(log, cmd, args, {
        title: 'generator output',
        argsWrapWidth: 100,
      });
    }

    log.pass(`Scaffold completed successfully`);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    log.fail(`Scaffold failed: ${msg}`);
    throw e;
  }

  // 6) Postcondition: ensure appDir now exists
  const created = await fs.pathExists(appDir);
  if (!created) {
    log.fail(`Scaffold reported success but path not found: ${appDir}`);
    throw new Error(`Scaffold did not produce ${appDir}`);
  }

  // 7) Prepare cleanup
  const keep = !!opts.keepArtifacts;
  const cleanup = async () => {
    if (keep) {
      log.write(`keepArtifacts=true → not removing ${appDir}`);
      return;
    }
    try {
      log.step(`Cleanup .tmp files`);
      await fs.remove(appDir);
      log.write(`Removed ${appDir}`);
    } catch (err: any) {
      log.write(`Cleanup failed for ${appDir}: ${err?.message ?? err}`);
    }
  };

  return { appDir, logPath: log.filePath, cleanup, log };
}
