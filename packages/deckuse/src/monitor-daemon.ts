import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { monitorDir } from '@deckflow/deckuse-workspace';
import { startMonitor, type MonitorHandle } from './monitor.js';

export interface DaemonMeta {
  readonly pid: number;
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly workspace: string;
  readonly startedAt: string;
}

export const daemonMetaPath = (workspace: string) => join(monitorDir(workspace), 'daemon.json');

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export async function readDaemonMeta(workspace: string): Promise<DaemonMeta | null> {
  try {
    const raw = await readFile(daemonMetaPath(workspace), 'utf8');
    return JSON.parse(raw) as DaemonMeta;
  } catch {
    return null;
  }
}

export async function writeDaemonMeta(workspace: string, meta: DaemonMeta): Promise<void> {
  await mkdir(monitorDir(workspace), { recursive: true });
  await writeFile(daemonMetaPath(workspace), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

export async function clearDaemonMeta(workspace: string): Promise<void> {
  try {
    await rm(daemonMetaPath(workspace), { force: true });
  } catch {
    // ignore
  }
}

export async function probeMonitor(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export async function monitorStatus(workspace: string): Promise<{
  running: boolean;
  meta: DaemonMeta | null;
  reachable: boolean;
}> {
  const meta = await readDaemonMeta(workspace);
  if (!meta) return { running: false, meta: null, reachable: false };
  const running = isAlive(meta.pid);
  const reachable = running ? await probeMonitor(meta.url) : false;
  if (!running) await clearDaemonMeta(workspace);
  return { running, meta: running ? meta : null, reachable };
}

export async function monitorStop(workspace: string): Promise<{ stopped: boolean; meta: DaemonMeta | null }> {
  const meta = await readDaemonMeta(workspace);
  if (!meta) return { stopped: false, meta: null };
  if (isAlive(meta.pid)) {
    try {
      process.kill(meta.pid, 'SIGTERM');
    } catch {
      // ignore
    }
    for (let i = 0; i < 20; i++) {
      if (!isAlive(meta.pid)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (isAlive(meta.pid)) {
      try {
        process.kill(meta.pid, 'SIGKILL');
      } catch {
        // ignore
      }
    }
  }
  await clearDaemonMeta(workspace);
  return { stopped: true, meta };
}

/**
 * Spawn a detached deckuse monitor worker and persist daemon.json.
 * The child runs `deckuse monitor --daemon-worker` in the foreground of that process.
 */
export async function monitorStart(
  workspace: string,
  options: { host?: string; port?: number } = {},
): Promise<DaemonMeta> {
  const existing = await monitorStatus(workspace);
  if (existing.running && existing.meta) return existing.meta;

  const host = options.host ?? '0.0.0.0';
  const port = options.port ?? 4173;
  const bin = process.argv[1];
  if (!bin) throw new Error('Cannot resolve deckuse binary path for daemon start');

  const child = spawn(
    process.execPath,
    [
      bin,
      'monitor',
      '--daemon-worker',
      '--workspace',
      workspace,
      '--host',
      host,
      '--port',
      String(port),
    ],
    {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    },
  );
  child.unref();
  if (child.pid == null) throw new Error('Failed to spawn monitor daemon');

  // Wait briefly for the worker to bind and write meta (worker also writes; parent seeds pid).
  const urlGuess = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/`;
  let meta: DaemonMeta = {
    pid: child.pid,
    host,
    port,
    url: urlGuess,
    workspace,
    startedAt: new Date().toISOString(),
  };
  await writeDaemonMeta(workspace, meta);

  for (let i = 0; i < 40; i++) {
    const disk = await readDaemonMeta(workspace);
    if (disk?.url) meta = disk;
    if (await probeMonitor(meta.url)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return meta;
}

/** Foreground monitor used by CLI and by `--daemon-worker`. */
export async function runMonitorForeground(
  workspace: string,
  options: { host?: string; port?: number; asDaemonWorker?: boolean } = {},
): Promise<MonitorHandle> {
  const monitor = await startMonitor(workspace, {
    host: options.host ?? '0.0.0.0',
    port: options.port ?? 4173,
  });
  if (options.asDaemonWorker) {
    const port = Number(new URL(monitor.url).port || (options.port ?? 4173));
    await writeDaemonMeta(workspace, {
      pid: process.pid,
      host: options.host ?? '0.0.0.0',
      port,
      url: monitor.url,
      workspace,
      startedAt: new Date().toISOString(),
    });
    const cleanup = async () => {
      await clearDaemonMeta(workspace);
      await monitor.close();
    };
    process.once('SIGINT', () => void cleanup().then(() => process.exit(0)));
    process.once('SIGTERM', () => void cleanup().then(() => process.exit(0)));
  }
  return monitor;
}
