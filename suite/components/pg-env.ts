// suite/components/pg-env.ts
export type PgEnv = {
  PG_HOST: string; // host IP (loopback)
  PG_PORT: number; // host port mapped from 5432
  PG_USER: string; // 'postgres'
  PG_PASS: string; // password set for container
};

export function getSuitePgEnv(): PgEnv {
  // reads SUITE_PG_HOST/PORT/USER/PASS
  return {
    PG_HOST: process.env.SUITE_PG_HOST!,
    PG_PORT: Number(process.env.SUITE_PG_PORT!),
    PG_USER: process.env.SUITE_PG_USER!,
    PG_PASS: process.env.SUITE_PG_PASS ?? '',
  };
}
