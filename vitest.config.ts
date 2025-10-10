// vitest.config.ts
import { defineConfig } from 'vitest/config';

import KnaSequencer from './suite/sequencer.ts';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './suite/global-setup.ts',

    // Run in-band to keep CI/progressive output strictly ordered
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    // include: ['test/**/*.test.ts', 'test/**/*.spec.ts'],
    // exclude: ['**/node_modules/**', '**/dist/**', '**/.{idea,git,cache,output,temp}/**'],

    // Deterministic file order: Suite -> Schema -> Scenarios -> other
    sequence: {
      sequencer: KnaSequencer,
      concurrent: false,
      shuffle: false,
      hooks: 'list',
    },

    // Don’t bail on first failure; we want a full run summary
    bail: 0,

    // Keep interop default to load ESM reporters/helpers smoothly
    deps: {
      interopDefault: true,
    },

    // Reporters: Vitest default + your custom reporter file
    reporters: ['./suite/vitest-reporter.ts'],

    // Handy defaults for slower E2E:
    testTimeout: 240_000,
    hookTimeout: 120_000,
  },
});
