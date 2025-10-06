// test/e2e/scenarios/_runner/types.ts

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
  tests: {
    assertScaffold?: AssertScaffoldSpec;
    assertEnv?: { manifest: string };
    /**
     * Reserved for a future step. The runner currently IGNORES this on purpose,
     * so we can discuss semantics and keep commits crisp.
     */
    mergeEnv?: { env: string };
    cleanup?: boolean;
  };
};

export type AssertScaffoldSpec = {
  flags?: string[];
  answersFile?: string;
  interactive?: {
    prompts?: Array<
      | { expect: string; send: string; timeoutMs?: number; type?: 'text' }
      | {
          expect: string;
          labels: string[];
          required?: boolean;
          maxScroll?: number;
          timeoutMs?: number;
          type: 'checkbox';
        }
    >;
    include?: Array<string | { [k: string]: string }>;
  };
};

/** ----- Prompt map JSON (loaded at runtime) ----- */

export type PromptMap = {
  text?: Array<{
    key: string;
    expect: string;
    sendIfPresent: string;
    sendIfAbsent: string;
    timeoutMs?: number;
  }>;
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
    steps: Array<{
      type?: 'text';
      expect: string;
      send: string;
      timeoutMs?: number;
    }>;
  }>;
};
