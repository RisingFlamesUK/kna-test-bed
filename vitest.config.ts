// vitest.config.ts
import { defineConfig } from 'vitest/config';

import SuiteReporter from './suite/vitest-reporter.ts';

export default defineConfig({
  test: {
    environment: 'node',
    // Run once, before all test files:
    globalSetup: './suite/global-setup.ts',
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.{idea,git,cache,output,temp}/**'],
    reporters: [['default', { summary: false }], new SuiteReporter()],
    // Handy defaults for slower E2E:
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Optional: isolate false if you share state (we don't here)
    // isolate: true,
  },
});
