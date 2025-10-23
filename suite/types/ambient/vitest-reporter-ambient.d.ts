// Ambient module to provide a typed subpath for Reporter until TS resolves 'vitest/reporter' locally
// This mirrors Vitest's deprecation guidance: import Reporter from 'vitest/reporter'
// and maps it to the Reporter type from 'vitest' for compatibility.
declare module 'vitest/reporter' {
  export type Reporter = import('vitest').Reporter;
}
