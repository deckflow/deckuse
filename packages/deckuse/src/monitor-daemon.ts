import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { monitorDir } from '@deckflow/deckuse-workspace';
import { startMonitor, type MonitorHandle } from './monitor.js';
import {
  discoverMonitorsFromProcessTable,
  isProcessAlive,
  listMonitorRegistrations,
  processLooksLikeMonitorDaemon,
  removeMonitorRegistration,
  upsertMonitorRegistration,
  type DaemonMeta,
} from './monitor-registry.js';

export type { DaemonMeta } from './monitor-registry.js';

export const daemonMetaPath = (workspace: string) => join(monitorDir(workspace), 'daemon.json');

export { isProcessAlive as isAlive };

export async function readDaemonMeta(workspace: string): Promise<DaemonMeta | null> {
  try {
    const raw = await readFile(daemonMetaPath(workspace), 'utf8');
    return JSON.parse(raw) as DaemonMeta;
  } catch {
    return null;
  }
}

async function syncGlobalUpsert(meta: DaemonMeta): Promise<void> {
  try {
    await upsertMonitorRegistration(meta);
  } catch {
    // best-effort; local meta remains authoritative for single-workspace ops
  }
}

async function syncGlobalRemove(workspace: string): Promise<void> {
  try {
    await removeMonitorRegistration(workspace);
  } catch {
    // ignore
  }
}

export async function writeDaemonMeta(workspace: string, meta: DaemonMeta): Promise<void> {
  await mkdir(monitorDir(workspace), { recursive: true });
  const normalized: DaemonMeta = { ...meta, workspace: resolve(workspace) };
  await writeFile(daemonMetaPath(workspace), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  await syncGlobalUpsert(normalized);
}

export async function clearDaemonMeta(workspace: string): Promise<void> {
  try {
    await rm(daemonMetaPath(workspace), { force: true });
  } catch {
    // ignore
  }
  await syncGlobalRemove(workspace);
}

export async function probeMonitor(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

/**
 * If pid is alive but does not look like our daemon, refuse to signal it.
 * Returns true when it is safe to send SIGTERM/SIGKILL.
 */
async function maySignalMonitorPid(pid: number, workspace: string): Promise<boolean> {
  if (!isProcessAlive(pid)) return false;
  const looks = await processLooksLikeMonitorDaemon(pid, workspace);
  // Inconclusive (e.g. Windows / ps failed): allow signal if alive — legacy behavior.
  if (looks === null) return true;
  return looks;
}

export async function monitorStatus(workspace: string): Promise<{
  running: boolean;
  meta: DaemonMeta | null;
  reachable: boolean;
}> {
  const abs = resolve(workspace);
  const meta = await readDaemonMeta(abs);
  if (!meta) return { running: false, meta: null, reachable: false };
  const running = isProcessAlive(meta.pid);
  if (!running) {
    await clearDaemonMeta(abs);
    return { running: false, meta: null, reachable: false };
  }
  const looks = await processLooksLikeMonitorDaemon(meta.pid, abs);
  if (looks === false) {
    // PID reused by an unrelated process — prune registration without killing.
    await clearDaemonMeta(abs);
    return { running: false, meta: null, reachable: false };
  }
  const reachable = await probeMonitor(meta.url);
  // Heal global registry if local is authoritative and running.
  await syncGlobalUpsert({ ...meta, workspace: abs });
  return { running: true, meta: { ...meta, workspace: abs }, reachable };
}

export interface MonitorStatusEntry extends DaemonMeta {
  readonly running: boolean;
  readonly reachable: boolean;
}

function displayUrl(host: string, port: number): string {
  const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  return `http://${displayHost}:${String(port)}/`;
}

/**
 * Merge registry files with live process-table discovery, reconcile, return running monitors.
 */
export async function monitorStatusAll(): Promise<{ monitors: MonitorStatusEntry[] }> {
  const byWorkspace = new Map<string, DaemonMeta>();

  for (const reg of await listMonitorRegistrations()) {
    byWorkspace.set(resolve(reg.workspace), {
      ...reg,
      workspace: resolve(reg.workspace),
    });
  }

  for (const disc of await discoverMonitorsFromProcessTable()) {
    const ws = resolve(disc.workspace);
    const existing = byWorkspace.get(ws);
    if (existing && existing.pid === disc.pid) continue;
    const host = disc.host ?? existing?.host ?? '0.0.0.0';
    const port = disc.port ?? existing?.port ?? 4173;
    byWorkspace.set(ws, {
      pid: disc.pid,
      host,
      port,
      url: existing?.url ?? displayUrl(host, port),
      workspace: ws,
      startedAt: existing?.startedAt ?? new Date().toISOString(),
    });
  }

  const monitors: MonitorStatusEntry[] = [];
  for (const [ws, meta] of byWorkspace) {
    const running = isProcessAlive(meta.pid);
    if (!running) {
      await removeMonitorRegistration(ws);
      const local = await readDaemonMeta(ws);
      if (local?.pid === meta.pid) {
        try {
          await rm(daemonMetaPath(ws), { force: true });
        } catch {
          // ignore
        }
      }
      continue;
    }
    const looks = await processLooksLikeMonitorDaemon(meta.pid, ws);
    if (looks === false) {
      await removeMonitorRegistration(ws);
      const local = await readDaemonMeta(ws);
      if (local?.pid === meta.pid) {
        try {
          await rm(daemonMetaPath(ws), { force: true });
        } catch {
          // ignore
        }
      }
      continue;
    }
    const reachable = await probeMonitor(meta.url);
    // Do not persist process-table-only discoveries here (plan: read-only until heal path).
    // Heal only when local daemon.json already exists.
    const local = await readDaemonMeta(ws);
    if (local && isProcessAlive(local.pid)) {
      await syncGlobalUpsert({ ...meta, workspace: ws });
    }
    monitors.push({
      ...meta,
      workspace: ws,
      running: true,
      reachable,
    });
  }

  monitors.sort((a, b) => a.workspace.localeCompare(b.workspace));
  return { monitors };
}

export async function monitorStop(workspace: string): Promise<{ stopped: boolean; meta: DaemonMeta | null }> {
  const abs = resolve(workspace);
  const meta = await readDaemonMeta(abs);
  // Also try global registration if local missing (desync).
  let target = meta;
  if (!target) {
    const regs = await listMonitorRegistrations();
    target = regs.find((r) => resolve(r.workspace) === abs) ?? null;
  }
  if (!target) {
    // Process-table fallback
    const disc = (await discoverMonitorsFromProcessTable()).find((d) => resolve(d.workspace) === abs);
    if (disc) {
      const host = disc.host ?? '0.0.0.0';
      const port = disc.port ?? 4173;
      target = {
        pid: disc.pid,
        host,
        port,
        url: displayUrl(host, port),
        workspace: abs,
        startedAt: new Date().toISOString(),
      };
    }
  }
  if (!target) return { stopped: false, meta: null };

  if (await maySignalMonitorPid(target.pid, abs)) {
    try {
      process.kill(target.pid, 'SIGTERM');
    } catch {
      // ignore
    }
    for (let i = 0; i < 20; i++) {
      if (!isProcessAlive(target.pid)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (isProcessAlive(target.pid) && (await maySignalMonitorPid(target.pid, abs))) {
      try {
        process.kill(target.pid, 'SIGKILL');
      } catch {
        // ignore
      }
    }
  }
  await clearDaemonMeta(abs);
  return { stopped: true, meta: target };
}

export async function monitorStopAll(): Promise<{
  stopped: number;
  results: Array<{ workspace: string; stopped: boolean; meta: DaemonMeta | null }>;
}> {
  const { monitors } = await monitorStatusAll();
  const results: Array<{ workspace: string; stopped: boolean; meta: DaemonMeta | null }> = [];
  for (const entry of monitors) {
    const result = await monitorStop(entry.workspace);
    results.push({ workspace: entry.workspace, ...result });
  }
  return { stopped: results.filter((r) => r.stopped).length, results };
}

/**
 * Spawn a detached deckuse monitor worker and persist daemon.json.
 * The child runs `deckuse monitor --daemon-worker` in the foreground of that process.
 */
export async function monitorStart(
  workspace: string,
  options: { host?: string; port?: number } = {},
): Promise<DaemonMeta> {
  const abs = resolve(workspace);
  const existing = await monitorStatus(abs);
  if (existing.running && existing.meta) {
    if (existing.reachable) return existing.meta;
    await monitorStop(abs);
  }

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
      abs,
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
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const urlGuess = `http://${displayHost}:${port}/`;
  let meta: DaemonMeta = {
    pid: child.pid,
    host,
    port,
    url: urlGuess,
    workspace: abs,
    startedAt: new Date().toISOString(),
  };
  await writeDaemonMeta(abs, meta);

  let reachable = false;
  for (let i = 0; i < 40; i++) {
    const disk = await readDaemonMeta(abs);
    if (disk?.url) meta = disk;
    if (await probeMonitor(meta.url)) {
      reachable = true;
      break;
    }
    if (!isProcessAlive(child.pid)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!reachable) {
    try {
      if (isProcessAlive(child.pid)) process.kill(child.pid, 'SIGTERM');
    } catch {
      // ignore
    }
    await clearDaemonMeta(abs);
    throw new Error(
      `Monitor failed to start on ${host}:${String(port)} (EADDRINUSE or bind failure). ` +
        `Try --port 0 for an ephemeral port, or run deckuse monitor status.`,
    );
  }
  return meta;
}

/** Foreground monitor used by CLI and by `--daemon-worker`. */
export async function runMonitorForeground(
  workspace: string,
  options: { host?: string; port?: number; asDaemonWorker?: boolean } = {},
): Promise<MonitorHandle> {
  const abs = resolve(workspace);
  const monitor = await startMonitor(abs, {
    host: options.host ?? '0.0.0.0',
    port: options.port ?? 4173,
  });
  if (options.asDaemonWorker) {
    const port = Number(new URL(monitor.url).port || (options.port ?? 4173));
    await writeDaemonMeta(abs, {
      pid: process.pid,
      host: options.host ?? '0.0.0.0',
      port,
      url: monitor.url,
      workspace: abs,
      startedAt: new Date().toISOString(),
    });
    const cleanup = async () => {
      await clearDaemonMeta(abs);
      await monitor.close();
    };
    process.once('SIGINT', () => void cleanup().then(() => process.exit(0)));
    process.once('SIGTERM', () => void cleanup().then(() => process.exit(0)));
  }
  return monitor;
}
