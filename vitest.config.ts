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
    include: ['test/e2e/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      // Exclude moved/placeholder schema test to prevent a duplicate Schema CI block
      'test/e2e/scenarios/_runner/prompt-map.schema.test.ts',
    ],

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

    // Allow reporter to intercept console output from tests for boxing/order
    // disableConsoleIntercept: true,

    // Use our test reporter only
    reporters: ['./suite/vitest-reporter-hierarchical.ts'], // Output configuration - let our reporter handle all output
    silent: true,
    logHeapUsage: false,

    // Extended timeouts to accommodate real-world npm install times
    testTimeout: 600_000, // 10 minutes
    hookTimeout: 600_000, // 10 minutes
  },
});
