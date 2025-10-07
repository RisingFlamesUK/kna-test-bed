// suite/components/pg-suite.ts
// Single Postgres container per run + per-test DB lifecycle helpers

import * as crypto from 'node:crypto';

import { Client } from 'pg';

import type { Logger } from '../types/logger.ts';
import { runContainer, waitForTcp, waitForHealthy, removeByLabel } from './docker-suite.ts';
import { KNA_LABEL } from './constants.ts';
import type { PgEnv } from './pg-env.ts';
import { getSuitePgEnv } from './pg-env.ts';

let sharedDbName: string | null = null;

export type PgHandle = {
  env: PgEnv;
  containerName: string; // name/id returned by docker
  stop: () => Promise<void>; // stops the container
};

let singleton: PgHandle | null = null;
let inFlight: Promise<PgHandle> | null = null;

/** Start the single shared Postgres container (idempotent & race-safe). */
export async function ensurePg(log?: Logger, opts?: { clean?: boolean }): Promise<PgHandle> {
  if (singleton) return singleton;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    // Only clean when explicitly requested (e.g., from global-setup)
    if (opts?.clean) {
      await removeByLabel(KNA_LABEL, log);
    }

    const image = 'postgres:16-alpine';
    const pgUser = 'postgres';
    const pgPass = 'postgres'; // set a real password for SCRAM auth

    log?.step?.('Starting Postgres container');

    // Ask Docker to assign an ephemeral host port for container's 5432
    const container = await runContainer({
      image,
      env: {
        POSTGRES_USER: pgUser,
        POSTGRES_PASSWORD: pgPass,
      },
      publish: [{ containerPort: 5432, host: '127.0.0.1' }],
      detach: true,
      removeOnStop: true,
      preArgs: [
        '--label',
        KNA_LABEL,
        '--health-cmd',
        'pg_isready -U postgres -d postgres || exit 1',
        '--health-interval',
        '1s',
        '--health-timeout',
        '3s',
        '--health-retries',
        '20',
      ],
      log,
    });

    // Discover the mapped host port for 5432
    const hostPort = await container.getHostPort(5432);
    if (!hostPort) {
      const msg = 'Could not determine mapped host port for Postgres (5432)';
      log?.fail?.(msg);
      throw new Error(msg);
    }

    log?.write?.(`• Waiting for container to become "healthy"...`);
    // Wait for Docker health to flip to 'healthy'
    await waitForHealthy(container.name, log);
    log?.write?.(`OK`, '+2');

    log?.write?.(`• Waiting for port to accept connections: host=127.0.0.1 port=${hostPort}...`);
    // Wait until the TCP port is accepting connections
    await waitForTcp('127.0.0.1', hostPort, 30_000, log);
    log?.write?.(`OK`, '+2');

    log?.write?.(`• Performing quick check that PG is available...`);
    // Optional: a quick SQL probe for extra certainty
    await probePg('127.0.0.1', hostPort, pgUser, pgPass);
    log?.write?.(`OK`, '+2');

    const env: PgEnv = {
      PG_HOST: '127.0.0.1',
      PG_PORT: hostPort,
      PG_USER: pgUser,
      PG_PASS: pgPass,
    };

    const handle: PgHandle = {
      env,
      containerName: container.name,
      stop: async () => {
        try {
          await container.stop();
        } finally {
          singleton = null;
        }
      },
    };

    singleton = handle;
    log?.pass?.(`Postgres container: "${container.name}" is ready at 127.0.0.1:${hostPort}`);
    return handle;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Run a test body inside a unique schema; drops the schema afterwards. */
export async function withTempSchema<T>(
  prefix: string,
  run: (utils: {
    schema: string;
    connect: () => Promise<Client>;
    searchPathSql: string;
  }) => Promise<T>,
  log?: Logger,
): Promise<T> {
  const { name: dbName, env } = await ensureSharedDb(log);
  const schema = `${prefix}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;

  // helper: connect to shared DB
  const connect = async () => {
    const client = new Client({
      host: env.PG_HOST,
      port: env.PG_PORT,
      user: env.PG_USER,
      password: env.PG_PASS || undefined,
      database: dbName,
    });
    await client.connect();
    return client;
  };

  const admin = await connect();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await admin.end().catch(() => void 0);
  }

  const searchPathSql = `SET search_path TO "${schema}", public`;

  let result!: T;
  try {
    result = await run({ schema, connect, searchPathSql });
  } finally {
    const dropper = await connect();
    try {
      await dropper.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await dropper.end().catch(() => void 0);
    }
  }
  return result;
}

/** Ensure a single shared DB exists for schema-based tests (lighter than per-db). */
async function ensureSharedDb(log?: Logger): Promise<{ name: string; env: PgEnv }> {
  const env = getSuitePgEnv();

  if (sharedDbName) return { name: sharedDbName, env };

  const name = `e2e_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const admin = new Client({
    host: env.PG_HOST,
    port: env.PG_PORT,
    user: env.PG_USER,
    password: env.PG_PASS || undefined,
    database: 'postgres',
  });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  sharedDbName = name;
  log?.pass?.(`Shared DB ready: ${name}`);
  return { name, env: env };
}

/** Shallow connectivity probe using node-postgres. */
async function probePg(host: string, port: number, user: string, password: string) {
  const client = new Client({
    host,
    port,
    user,
    password,
    database: 'postgres',
  });
  await client.connect();
  try {
    await client.query('select 1');
  } finally {
    await client.end();
  }
}

/** Create a database for a test case (connects via default 'postgres' DB). */
export async function createDb(dbName: string, log?: Logger): Promise<void> {
  if (!singleton) throw new Error('ensurePg() must be called first');
  const { PG_HOST, PG_PORT, PG_USER, PG_PASS } = singleton.env;

  log?.step?.(`Create DB ${dbName}`);
  const client = new Client({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASS,
    database: 'postgres',
  });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
  log?.pass?.();
}

/** Drop a database created for a test (best-effort). */
export async function dropDb(dbName: string, log?: Logger): Promise<void> {
  if (!singleton) return; // already torn down
  const { PG_HOST, PG_PORT, PG_USER, PG_PASS } = singleton.env;

  log?.step?.(`Drop DB ${dbName}`);
  const client = new Client({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASS,
    database: 'postgres',
  });
  await client.connect();
  try {
    // Try PG >= 13 shortcut first
    try {
      await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } catch {
      // Fallback: terminate connections then drop
      await client.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    }
  } finally {
    await client.end();
  }
  log?.pass?.();
}
