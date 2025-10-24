#!/usr/bin/env node
import { execa } from 'execa';

async function main() {
  const [,, version, ...rest] = process.argv;
  if (!version || /^-/.test(version)) {
    console.error('Usage:');
    console.error('  npm run test:pre -- <version> [vitest-args]');
    console.error('  npm run test:pre:report -- <version> [vitest-args]   # always exit 0 (for log collection)');
    console.error('Examples:');
    console.error('  npm run test:pre -- 0.4.2');
    console.error("  npm run test:pre -- 0.4.2 -t 'silent mode: scaffolds app without errors'");
    process.exit(1);
  }

  process.env.PRE_RELEASE_VERSION = version;

  // Forward any additional args directly to Vitest (e.g., -t, --reporter, etc.)
  const vitestArgs = ['run', ...rest];

  try {
    const child = execa('vitest', vitestArgs, { stdio: 'inherit', preferLocal: true });
    const { exitCode } = await child;
    if (process.env.ALLOW_TEST_FAILURES) {
      process.exit(0);
    }
    process.exit(exitCode ?? 0);
  } catch (err) {
    // execa throws on non-zero exit; honor ALLOW_TEST_FAILURES or rethrow status
    if (process.env.ALLOW_TEST_FAILURES) {
      process.exit(0);
    }
    const code = typeof err?.exitCode === 'number' ? err.exitCode : 1;
    process.exit(code);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
