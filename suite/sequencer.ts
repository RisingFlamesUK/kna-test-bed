// suite/sequencer.ts
import type { TestSpecification } from 'vitest/node';
import { BaseSequencer } from 'vitest/node';
import path from 'node:path';

export default class KnaSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    // Normalize to posix for matching
    const toPosix = (p: string) => p.split(path.sep).join('/');

    const getPath = (spec: TestSpecification): string => {
      // Vitest v3 tuple: [project, file, { pool }]
      //                0          1         2
      return spec[1];
    };

    const rank = (spec: TestSpecification) => {
      const p = toPosix(getPath(spec));
      // 1) Suite first
      if (/^test\/e2e\/suite\.test\.ts$/i.test(p)) return 0;
      // 2) Schema next
      if (/^test\/e2e\/scenarios\/_runner\/prompt-map\.schema\.test\.ts$/i.test(p)) return 1;
      // 3) Scenario tests (e.g., local-only/*.test.ts)
      if (/^test\/e2e\/scenarios\/.+\/.+\.test\.ts$/i.test(p)) return 2;
      // 4) Everything else
      return 3;
    };

    return [...files].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      // stable tiebreak by path
      return getPath(a).localeCompare(getPath(b));
    });
  }

  // In-band; no sharding transforms needed
  async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    return files;
  }
}
