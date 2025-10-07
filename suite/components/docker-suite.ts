// suite/components/docker-suite.ts
import * as net from 'node:net';
import * as crypto from 'node:crypto';

import { execa } from 'execa';

import type { Logger } from '../types/logger.ts';
import { execBoxed, type SimpleExec } from './proc.ts';

let _dockerEnsured = false;

/** Ensure Docker CLI is present and daemon is running. Throws with a friendly message if not. */
export async function ensureDocker(log?: Logger): Promise<void> {
  try {
    if (_dockerEnsured) return;
    await execa('docker', ['info'], { stdio: 'ignore', windowsHide: true });
    log?.pass?.('Docker is available');
    _dockerEnsured = true;
  } catch {
    const msg =
      'Docker CLI not found or daemon not running. Start Docker Desktop/daemon and try again.';
    log?.fail?.(msg);
    throw new Error(msg);
  }
}

/**
 * Run `docker …` with consistent logging/boxing.
 * - background=true: quiet run (no boxing), returns stdout/exitCode; windowsHide defaults to true.
 * - background=false: boxed output via execBoxed with optional title/argsWrapWidth/windowsHide.
 */
async function runDocker(
  args: string[],
  opts: {
    log?: Logger;
    title?: string;
    argsWrapWidth?: number;
    windowsHide?: boolean;
    background?: boolean;
  } = {},
): Promise<SimpleExec> {
  const { log, title = 'docker output', argsWrapWidth, windowsHide, background } = opts;

  if (background) {
    const r = await execa('docker', args, { windowsHide: windowsHide ?? true });
    return {
      stdout: typeof r.stdout === 'string' ? r.stdout : String(r.stdout ?? ''),
      exitCode: (r as any).exitCode ?? 0,
    };
  }

  const r = await execBoxed(log, 'docker', args, {
    title,
    argsWrapWidth,
    windowsHide,
  });

  const stdout =
    typeof (r as any).stdout === 'string'
      ? (r as any).stdout
      : Buffer.isBuffer((r as any).stdout)
        ? (r as any).stdout.toString('utf8')
        : Array.isArray((r as any).stdout)
          ? (r as any).stdout.join('')
          : String((r as any).stdout ?? '');

  return {
    stdout,
    exitCode: (r as any).exitCode ?? 0,
  };
}

/** Generate a short, unique name for containers and networks. */
export function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

/** Wait for a TCP port to accept connections. */
export async function waitForTcp(
  host: string,
  port: number,
  timeoutMs = 30_000,
  log?: Logger,
): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;

  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = new net.Socket();
        socket.once('error', reject);
        socket.connect(port, host, () => {
          socket.end();
          resolve();
        });
      });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  const msg = `TCP ${host}:${port} did not open in ${timeoutMs}ms. Last error: ${String(lastErr)}`;
  log?.fail?.(msg);
  throw new Error(msg);
}

/** Pull an image if not present (no-op when already pulled). */
export async function pullImage(image: string, log?: Logger): Promise<void> {
  log?.step?.('Docker: ensure Postgres image');
  try {
    await runDocker(['image', 'inspect', image], {
      background: true,
    });
    log?.pass?.(`image present: ${image}`);
  } catch {
    await runDocker(['pull', image], {
      log,
      title: 'docker output',
      argsWrapWidth: 100,
    });
  }
}

export type PublishSpec = {
  /** Container port, e.g. 5432 */
  containerPort: number;
  /** Host port; if omitted, Docker assigns an ephemeral host port. */
  hostPort?: number;
  /** Host IP to bind to (default 127.0.0.1). */
  host?: string;
};

export type RunContainerOptions = {
  name?: string;
  image: string;
  /** Environment variables to inject into the container. */
  env?: Record<string, string | number | boolean>;
  /** Port mappings. If you want Docker to pick the host port, omit hostPort. */
  publish?: PublishSpec[];
  /** Extra args (e.g. volumes, entrypoint overrides). */
  args?: string[];
  /** CLI flags that must go BEFORE the image (e.g., --label/--health-*) */
  preArgs?: string[];
  /** Run detached (default true). */
  detach?: boolean;
  /** Automatically remove container on stop (default true, uses --rm). */
  removeOnStop?: boolean;
  /** Optional network name (must exist). */
  network?: string;
  log?: Logger;
};

/**
 * Run a container (usually detached). Returns helper functions to manage it.
 * If name is omitted, Docker returns a container ID which we use as the handle.
 */
export async function runContainer(opts: RunContainerOptions): Promise<{
  name: string; // container name or id
  stop: () => Promise<void>;
  remove: () => Promise<void>;
  inspect: () => Promise<any>;
  getHostPort: (containerPort: number) => Promise<number | null>;
}> {
  const {
    image,
    env,
    publish,
    args = [],
    preArgs = [],
    detach = true,
    removeOnStop = true,
    network,
    log,
  } = opts;

  await ensureDocker(log);
  await pullImage(image, log);

  const name = opts.name ?? uniqueName(image.split(':')[0].replace(/[^\w.-]/g, ''));
  const cmd = ['run'];

  if (removeOnStop) cmd.push('--rm');
  cmd.push('--name', name);

  if (publish?.length) {
    for (const m of publish) {
      const host = m.host ?? '127.0.0.1';
      // If hostPort omitted, ask Docker to assign ephemeral: host::containerPort
      const spec =
        m.hostPort != null
          ? `${host}:${m.hostPort}:${m.containerPort}`
          : `${host}::${m.containerPort}`;
      cmd.push('--publish', spec);
    }
  }

  if (env) {
    for (const [k, v] of Object.entries(env)) {
      cmd.push('-e', `${k}=${String(v)}`);
    }
  }

  if (network) {
    cmd.push('--network', network);
  }

  if (detach) cmd.push('-d');

  if (preArgs.length) cmd.push(...preArgs);
  cmd.push(image);
  if (args.length) cmd.push(...args);

  log?.step?.(`Docker: run container (${image})`);
  const result = await runDocker(cmd, {
    log,
    title: 'docker output',
    argsWrapWidth: 100,
  });

  // When detached, stdout is container ID
  const containerHandle = opts.name ?? (result.stdout || '').trim();

  return {
    name: containerHandle,
    stop: async () => {
      try {
        // await execa("docker", ["stop", containerHandle], { windowsHide: true });
        await runDocker(['stop', containerHandle], { background: true });
      } catch {
        /* ignore */
      }
    },
    remove: async () => {
      try {
        // await execa("docker", ["rm", "-f", containerHandle], {
        //   windowsHide: true,
        // });
        await runDocker(['rm', '-f', containerHandle], { background: true });
      } catch {
        /* ignore */
      }
    },
    inspect: async () => {
      // const { stdout } = await execa("docker", ["inspect", containerHandle], {
      //   windowsHide: true,
      // });
      const { stdout } = await runDocker(['inspect', containerHandle], {
        background: true,
      });
      return JSON.parse(stdout)[0];
    },
    getHostPort: async (containerPort: number) => {
      // const info = await execa("docker", ["inspect", containerHandle], {
      //   windowsHide: true,
      // }).then((r) => JSON.parse(r.stdout)[0]);
      const info = await runDocker(['inspect', containerHandle], {
        background: true,
      }).then((r) => JSON.parse(r.stdout)[0]);

      const ports = info?.NetworkSettings?.Ports ?? {};
      const keyTcp = `${containerPort}/tcp`;
      const keyUdp = `${containerPort}/udp`;
      const binding = ports[keyTcp]?.[0]?.HostPort ?? ports[keyUdp]?.[0]?.HostPort ?? null;
      return binding ? Number(binding) : null;
    },
  };
}

/** Raw `docker inspect` JSON (first object). */
export async function inspect(name: string): Promise<any> {
  // const { stdout } = await execa("docker", ["inspect", name], {
  //   windowsHide: true,
  // });
  const { stdout } = await runDocker(['inspect', name], {
    background: true,
  });
  const arr = JSON.parse(stdout);
  return arr[0];
}

/** Wait until `docker inspect` reports health=healthy (requires container to define a HEALTHCHECK). */
export async function waitForHealthy(
  name: string,
  log?: Logger,
  timeoutMs = 25_000,
): Promise<void> {
  const start = Date.now();
  let delay = 250;

  for (;;) {
    const info = await inspect(name);
    const status = info?.State?.Health?.Status as string | undefined;
    if (status === 'healthy') return;

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for health=healthy (status=${status ?? 'unknown'})`);
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.6, 1500);
  }
}

/** Remove any running containers that match a docker label. No-op if none found. */
export async function removeByLabel(label: string, log?: Logger): Promise<void> {
  try {
    log?.step?.(`Docker: Checking for stale containers with label="${label}" to cleanup`);

    // Run quietly to avoid an empty box when there are no results
    const r = await runDocker(['ps', '-q', '--filter', `label=${label}`], {
      background: true,
    });

    const ids = r.stdout.split(/\r?\n/).filter(Boolean);
    if (!ids.length) {
      log?.pass?.('No stale containers');
      return;
    }

    log?.step?.(`Removing ${ids.length} containers (label=${label})`);

    await runDocker(['rm', '-f', ...ids], {
      log,
      title: 'docker output',
      argsWrapWidth: 100,
    });
    log?.pass?.('Removed stale containers');
  } catch (e: any) {
    log?.write?.(`(warn) removeByLabel failed: ${e?.shortMessage ?? e?.message ?? String(e)}`);
  }
}

// THE FOLLOWING ARE INTENTIONALLY COMMENTED IN CASE THEY ARE NEEDED LATER
/** Find a free local TCP port on the given host (default 127.0.0.1). */
// export function getFreePort(host = "127.0.0.1"): Promise<number> {
//   return new Promise((resolve, reject) => {
//     const srv = net.createServer();
//     srv.on("error", reject);
//     srv.listen(0, host, () => {
//       const addr = srv.address();
//       srv.close(() => {
//         if (typeof addr === "object" && addr && "port" in addr)
//           resolve(addr.port);
//         else reject(new Error("Could not determine free port"));
//       });
//     });
//   });
// }

/** Stop a container by name/id. */
// export async function stopContainer(name: string): Promise<void> {
//   try {
//       await runDocker(["stop", name], {
//               log,
//               title: "docker output",
//               argsWrapWidth: 100,
//             })
//   } catch {
//     /* ignore */
//   }
// }

/** Remove (force) a container by name/id. */
// export async function removeContainer(name: string): Promise<void> {
//   try {
//       await runDocker(["rm", "-f", name], {
//               log,
//               title: "docker output",
//               argsWrapWidth: 100,
//             })
//   } catch {
//     /* ignore */
//   }
// }

/** Whether the container is currently running. */
// export async function isRunning(name: string): Promise<boolean> {
//   try {
//       await runDocker(["inspect", "-f", "{{.State.Running}}", name], {
//               log,
//               title: "docker output",
//               argsWrapWidth: 100,
//             })
//     return stdout.trim() === "true";
//   } catch {
//     return false;
//   }
// }

/** Convenience: map a containerPort to its hostPort (first binding). */
// export async function getHostPort(
//   name: string,
//   containerPort: number
// ): Promise<number | null> {
//   const info = await inspect(name);
//   const ports = info?.NetworkSettings?.Ports ?? {};
//   const keyTcp = `${containerPort}/tcp`;
//   const keyUdp = `${containerPort}/udp`;
//   const binding =
//     ports[keyTcp]?.[0]?.HostPort ?? ports[keyUdp]?.[0]?.HostPort ?? null;
//   return binding ? Number(binding) : null;
// }
