// test/e2e/scenarios/_runner/scenario-runner.ts
import * as fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  scenarioLoggerFromEnv,
  buildScenarioLogPath,
} from '../../../../suite/components/logger.ts';
import { createCI } from '../../../../suite/components/ci.ts';
import { assertScaffoldCommand } from '../../../components/scaffold-command-assert.ts';
import { assertEnvMatches } from '../../../components/env-assert.ts';
import type { ScenarioConfigFile, ScenarioEntry, PromptMap } from './types.ts';
import type { Prompt } from '../../../components/interactive-driver.ts';
import { assertFiles } from '../../../components/fs-assert.ts';
import { recordScenarioSeverityFromEnv } from '../../../../suite/components/scenario-status.ts';
import { PROMPT_TIMEOUT_MS, SCENARIO_TEST_TIMEOUT_MS } from '../../../components/test-constants.ts';

type ResolveCtx = {
  configDir: string;
  configFileAbs: string;
  callerDir?: string;
  scenarioRootFromConfig?: string; // parent of config dir if config is under <scenario>/config
  manifestBase?: string;
  realEnvBase?: string;
  answersBase?: string;
  promptMap?: PromptMap;
};

export async function runScenariosFromFile(configPath: string, opts?: { callerDir?: string }) {
  const abs = path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
  const raw = await readFile(abs, 'utf8');
  const cfg: ScenarioConfigFile = JSON.parse(raw);
  const configDir = path.dirname(abs);

  // Only support the correct key now
  const manifestBase = cfg.manifestPath;

  // If config lives in <scenario>/config, derive <scenario>
  const scenarioRootFromConfig = path.dirname(configDir);

  const promptMap = await loadPromptMap(cfg.promptMapPath, configDir);

  // Extract config key from path (same logic as hierarchy collector)
  // For scenarios: test/e2e/scenarios/local-only/... -> local-only
  const configKey = path.basename(scenarioRootFromConfig);

  const ctx: ResolveCtx = {
    configDir,
    configFileAbs: abs,
    callerDir: opts?.callerDir,
    scenarioRootFromConfig,
    manifestBase,
    realEnvBase: cfg.realEnvPath,
    answersBase: cfg.answersBasePath,
    promptMap,
  };

  // Each scenario gets its own describe block using testGroupName
  for (const entry of cfg.scenarios) {
    defineScenario(entry, ctx, configKey);
  }
}

function defineScenario(entry: ScenarioEntry, ctx: ResolveCtx, configKey: string) {
  const testGroupName: string = entry.testGroupName;
  const title: string = entry.it ?? entry.testGroupName;

  describe(testGroupName, () => {
    it(
      title,
      async () => {
        const log = scenarioLoggerFromEnv(testGroupName);

        const hierarchyContext = {
          area: 'scenarios',
          config: configKey,
          testGroup: testGroupName,
          test: title,
        };

        const ci = createCI();

        let appDir = '';
        let cleanup: (() => Promise<void>) | undefined;

        // 1) Scaffold (silent / answers / interactive)
        if (entry.tests.assertScaffold) {
          const { flags = [], answersFile, interactive } = entry.tests.assertScaffold;

          const interactiveOpts: { prompts: Prompt[] } | undefined = interactive?.prompts
            ? { prompts: coercePrompts(interactive.prompts) }
            : interactive?.include
              ? { prompts: includeToPrompts(interactive.include, ctx.promptMap) }
              : undefined;

          const resolvedAnswers = answersFile
            ? resolveWithBasesVerbose(answersFile, orderAnswersBases(ctx), {
                kind: 'answersFile',
                log,
              })
            : undefined;

          let result;
          try {
            result = await assertScaffoldCommand({
              testGroupName: testGroupName,
              flags,
              answersFile: resolvedAnswers,
              log,
              interactive: interactiveOpts,
              hierarchyContext,
            });
            ci.testStep('scaffold: OK', 'ok', undefined, hierarchyContext);
            // Record scaffold OK in scenario detail for reporter
            recordScenarioSeverityFromEnv(testGroupName as string, 'ok', { step: 'scaffold' });
          } catch (e) {
            ci.testStep('scaffold: FAILED', 'fail', undefined, hierarchyContext);
            // Record scaffold FAIL in scenario detail for reporter
            recordScenarioSeverityFromEnv(testGroupName as string, 'fail', { step: 'scaffold' });
            throw e;
          }

          appDir = result.appDir;
          cleanup = result.cleanup;
        } else {
          throw new Error('tests.assertScaffold is required for each scenario');
        }

        try {
          expect(Boolean(appDir)).toBe(true);

          // 2a) Env assertions (ALWAYS run on the UNMERGED .env to verify scaffolder output)
          let envSeverity: 'ok' | 'warn' | 'fail' | null = null;
          if (entry.tests.assertEnv?.manifest) {
            const manifestPath = resolveWithBasesVerbose(
              entry.tests.assertEnv.manifest,
              orderManifestBases(ctx),
              { kind: 'manifest', log },
            );

            const envFile = path.join(appDir, '.env');
            log.step(`Env: validate .env against manifest`);
            log.write(`envFile=${envFile}`);
            log.write(`manifest=${manifestPath}`);

            try {
              const sev = await assertEnvMatches({
                appDir,
                manifestPath,
                log,
                testGroupName: testGroupName as string,
              });
              envSeverity = sev;
              ci.testStep(
                `env manifest checks: ${sev.toUpperCase()}`,
                sev as any,
                undefined,
                hierarchyContext,
              );
            } catch {
              // env-assert throws on FAIL — record and continue to files step
              ci.testStep('env manifest checks: FAIL', 'fail', undefined, hierarchyContext);
              envSeverity = 'fail';
              // Do not rethrow; we want to continue with file assertions
            }
          }

          // 2b) Filesystem assertions (required/forbidden paths via manifest)
          if (entry.tests.assertFiles?.manifest) {
            const filesManifestPath = resolveWithBasesVerbose(
              entry.tests.assertFiles.manifest,
              orderManifestBases(ctx),
              { kind: 'manifest', log },
            );

            // Pre-check manifest existence to style missing-file case consistently
            if (!fs.existsSync(filesManifestPath)) {
              log.step('Files: validate files against manifest');
              log.write(`cwd=${appDir}`);
              log.write(`manifest=${filesManifestPath}`);
              log.write('Manifest file not found:');
              log.boxStart('Missing file');
              log.boxLine(`• ${filesManifestPath}`);
              log.boxEnd('1 file');
              if ('fail' in log && typeof log.fail === 'function') log.fail('fs-assert: FAIL');
              else log.write('fs-assert: FAIL');
              ci.testStep('files manifest checks: FAIL', 'fail', undefined, hierarchyContext);
              // Record severity at files step with explanatory note for suite summary
              recordScenarioSeverityFromEnv(testGroupName as string, 'fail', {
                step: 'files',
                meta: { note: 'files manifest not found' },
              });
              throw new Error('files manifest missing');
            }

            try {
              await assertFiles({
                cwd: appDir,
                manifest: JSON.parse(await readFile(filesManifestPath, 'utf8')),
                manifestLabel: filesManifestPath,
                testGroupName: testGroupName as string,
                logger: log,
              });
              ci.testStep('files manifest checks: OK', 'ok', undefined, hierarchyContext);
            } catch (e) {
              ci.testStep('files manifest checks: FAILED', 'fail', undefined, hierarchyContext);
              throw e;
            }
          }

          // 3) Merge step — intentionally NOT IMPLEMENTED yet (placeholder)
          if (entry.tests.mergeEnv?.env) {
            log.step(
              `Merge: mergeEnv present in config (env="${entry.tests.mergeEnv.env}") — skipping (not implemented by runner)`,
            );
            // Mark mergeEnv as explicitly skipped (↩️)
            ci.testStep('mergeEnv: skipped (not implemented)', 'skip', undefined, hierarchyContext);
          }

          // Emit an explicit per-scenario log line now (primary emission)
          {
            const stamp = process.env.KNA_LOG_STAMP || '';
            const candidate = stamp
              ? buildScenarioLogPath(stamp, testGroupName as string)
              : path.join('logs', 'latest', 'e2e', `${testGroupName}.log`);
            const absLog = path.resolve(candidate).replace(/\\/g, '/').replace(/ /g, '%20');
            ci.write(`  - log: file:///${absLog}`, undefined, hierarchyContext);
          }

          // After both steps, fail the scenario if any step ended up with FAIL severity
          if (envSeverity === 'fail') {
            throw new Error('scenario failed due to env FAIL');
          }
        } finally {
          // Cleanup resources
          if (entry.tests.cleanup && cleanup) await cleanup();
          if ((log as any)?.close) await (log as any).close();
        }
      },
      SCENARIO_TEST_TIMEOUT_MS, // 3 minutes - allow time for interactive prompts
    );
  }); // Close describe block
}

/** ----- Prompt map loader / include → prompts ----- */

async function loadPromptMap(
  promptMapPath: string | undefined,
  configDir: string,
): Promise<PromptMap | undefined> {
  const candidates = [
    promptMapPath &&
      (path.isAbsolute(promptMapPath) ? promptMapPath : path.resolve(configDir, promptMapPath)),
    path.resolve(configDir, 'prompt-map.json'),
    path.resolve(process.cwd(), 'test/e2e/schema/fixtures/prompt-map-valid.json'),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const raw = await readFile(p, 'utf8');
      return JSON.parse(raw) as PromptMap;
    }
  }
  return undefined;
}

function includeToPrompts(
  include: Array<string | { [k: string]: string }>,
  map?: PromptMap,
): Prompt[] {
  if (!map) return fallbackIncludeToPrompts(include);

  const has = (token: string) =>
    include.some(
      (tok) => tok === token || (typeof tok === 'object' && tok !== null && token in tok),
    );

  const prompts: Prompt[] = [];

  for (const t of map.text ?? []) {
    prompts.push({
      type: 'text',
      expect: new RegExp(t.expect, 'i'),
      send: has(t.key) ? t.sendIfPresent : t.sendIfAbsent,
      timeoutMs: t.timeoutMs ?? PROMPT_TIMEOUT_MS,
    });
  }

  for (const c of map.checkbox ?? []) {
    const selectedValues = include
      .filter(
        (tok): tok is Record<string, string> =>
          typeof tok === 'object' && tok !== null && c.key in tok,
      )
      .map((obj) => obj[c.key])
      .map((val) => c.labelMap[val] ?? c.labelMap[String(val).toLowerCase()])
      .filter((v): v is string => !!v);

    if (selectedValues.length) {
      const item: any = {
        type: 'checkbox',
        expect: new RegExp(c.expect, 'i'),
        select: selectedValues,
        required: c.required ?? true,
        maxScroll: c.maxScroll ?? 200,
        timeoutMs: c.timeoutMs ?? PROMPT_TIMEOUT_MS,
      };
      if ((c as any).submitDefault) item.submit = true;
      prompts.push(item);
    }
  }

  for (const s of map.sequence ?? []) {
    if (has(s.when)) {
      for (const step of s.steps) {
        prompts.push({
          type: 'text',
          expect: new RegExp(step.expect, 'i'),
          send: step.send,
          timeoutMs: step.timeoutMs ?? PROMPT_TIMEOUT_MS,
        });
      }
    }
  }

  return prompts;
}

function fallbackIncludeToPrompts(include: Array<string | { [k: string]: string }>): Prompt[] {
  const raw: any[] = [];

  raw.push({
    expect: 'Include\\s+PostgreSQL\\?',
    send: include.some((x) => x === 'postgres') ? 'y\n' : 'n\n',
  });
  raw.push({
    expect: 'Enable\\s+session\\s+management\\?',
    send: include.some((x) => x === 'session') ? 'y\n' : 'n\n',
  });

  const passportItems = include.filter(
    (x): x is { [k: string]: string } => typeof x === 'object' && x !== null && 'passport' in x,
  );
  if (passportItems.length) {
    const labels = passportItems.map((o) => o.passport);
    raw.push({
      type: 'checkbox',
      expect: 'Select\\s+Passport\\s+strategies',
      labels,
      required: true,
      maxScroll: 100,
    });
  }

  return coercePrompts(raw);
}

/** ----- Resolution helpers ----- */
/**
 * For manifests, the fallback order is:
 *   1) <callerDir>/manifest
 *   2) <scenarioRootFromConfig>/manifest    ← e.g., <scenario>/manifest (when config lives under <scenario>/config)
 *   3) <configDir>/manifest
 *   4) manifestPath (if provided in JSON)
 *   5) <callerDir>
 *   6) <configDir>
 *   7) CWD
 */
function orderManifestBases(ctx: ResolveCtx) {
  const callerManifest = ctx.callerDir ? path.join(ctx.callerDir, 'manifest') : undefined;
  const scenarioRootManifest = ctx.scenarioRootFromConfig
    ? path.join(ctx.scenarioRootFromConfig, 'manifest')
    : undefined;
  const configManifest = path.join(ctx.configDir, 'manifest');

  return {
    // put caller-first fallbacks ahead of any declared base
    prefer: undefined,
    fallbacks: [
      callerManifest,
      scenarioRootManifest,
      configManifest,
      ctx.manifestBase,
      ctx.callerDir,
      ctx.configDir,
      process.cwd(),
    ],
  };
}

function orderAnswersBases(ctx: ResolveCtx) {
  return { prefer: ctx.answersBase, fallbacks: [ctx.callerDir, ctx.configDir, process.cwd()] };
}

function resolveWithBasesVerbose(
  value: string,
  bases: { prefer?: string; fallbacks: Array<string | undefined> },
  opts?: { kind?: string; log?: any },
) {
  const isAbs = path.isAbsolute(value);
  const candidates: string[] = [];

  if (isAbs) {
    candidates.push(value);
  } else {
    if (bases.prefer) candidates.push(path.resolve(bases.prefer, value));
    for (const b of bases.fallbacks) if (b) candidates.push(path.resolve(b, value));
    if (!bases.fallbacks?.includes(process.cwd())) {
      candidates.push(path.resolve(process.cwd(), value));
    }
  }

  const chosen = candidates.find((c) => fs.existsSync(c)) ?? candidates[candidates.length - 1];

  if (opts?.log && process.env.E2E_DEBUG_RESOLVE === '1') {
    const title = opts.kind ? `resolve:${opts.kind}` : 'resolve';
    opts.log.step(
      `${title}\n  value=${value}\n  chosen=${chosen}\n  candidates=\n${candidates.map((c) => `    - ${c}${fs.existsSync(c) ? '  (exists)' : ''}`).join('\n')}`,
    );
  }

  return chosen;
}

/** ----- Interactive prompt helpers ----- */

function coercePrompts(
  prompts: Array<
    | { expect: string; send: string; timeoutMs?: number; type?: 'text' }
    | {
        expect: string;
        labels: string[];
        required?: boolean;
        maxScroll?: number;
        timeoutMs?: number;
        type: 'checkbox';
      }
  >,
): Prompt[] {
  return prompts.map((p: any) => {
    if (p.type === 'checkbox') {
      const checkbox: Prompt = {
        type: 'checkbox',
        expect: new RegExp(p.expect, 'i'),
        select: p.labels,
        required: p.required ?? true,
        maxScroll: p.maxScroll ?? 200,
        timeoutMs: p.timeoutMs ?? PROMPT_TIMEOUT_MS,
      };
      return checkbox;
    }
    const textPrompt: Prompt = {
      type: 'text',
      expect: new RegExp(p.expect, 'i'),
      send: p.send,
      timeoutMs: p.timeoutMs ?? PROMPT_TIMEOUT_MS,
    };
    return textPrompt;
  });
}
