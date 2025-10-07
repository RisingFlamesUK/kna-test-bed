// test/e2e/scenarios/_runner/types.ts
import type { PromptSpec, PromptTextSpec } from '../../../../suite/types/prompts.ts';

export type ScenarioConfigFile = {
  describe?: string;

  /** Bases for resolving files */
  manifestPath?: string;
  realEnvPath?: string;
  answersBasePath?: string;

  /** Optional path to a JSON map that converts `interactive.include` → concrete prompts */
  promptMapPath?: string;

  scenarios: ScenarioEntry[];
};

export type ScenarioEntry = {
  it?: string;
  scenarioName: string;

  /**
   * Per-scenario tests configuration.
   * NOTE: This mirrors what scenario-runner.ts actually reads:
   * - assertScaffold: flags/answersFile/interactive
   * - assertEnv: { manifest }
   * - assertFiles: { manifest }   <-- added for v0.4.0
   * - mergeEnv: { env }           <-- present but runner intentionally ignores the merge step
   * - cleanup: boolean
   */
  tests: {
    assertScaffold?: AssertScaffoldSpec;
    assertEnv?: { manifest: string };
    assertFiles?: { manifest: string };
    mergeEnv?: { env: string };
    cleanup?: boolean;
  };
};

export type AssertScaffoldSpec = {
  flags?: string[];
  answersFile?: string;

  /**
   * Interactive prompt driving:
   * - 'include' lets tests reference higher level tokens that are expanded through the prompt map
   * - 'prompts' lets tests specify concrete prompts directly
   * - 'sequence' supports conditional flows (optional) if you ever need it
   */
  interactive?: {
    include?: Array<string | Record<string, string>>;

    prompts?: PromptSpec[];

    sequence?: Array<{
      when: string; // regex to detect a screen/prompt
      steps: Array<PromptTextSpec>; // sequence is always text prompts
    }>;
  };
};

/** ----- Prompt map JSON (loaded at runtime) ----- */
export type PromptMap = {
  text?: Array<
    // reuse PromptTextSpec fields for expect/timeoutMs, but map decides the 'send'
    Omit<PromptTextSpec, 'send' | 'type'> & {
      key: string;
      sendIfPresent: string;
      sendIfAbsent: string;
    }
  >;
  checkbox?: Array<{
    key: string;
    expect: string;
    labelMap: Record<string, string>;
    required?: boolean;
    maxScroll?: number;
    timeoutMs?: number;
    submitDefault?: boolean;
  }>;
  sequence?: Array<{
    when: string;
    steps: Array<PromptTextSpec>;
  }>;
};
