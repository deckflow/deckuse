import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface DaemonMeta {
  readonly pid: number;
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly workspace: string;
  readonly startedAt: string;
}

/** Override with DECKUSE_HOME for tests; default ~/.deckflow/deckuse */
export function deckuseHome(): string {
  const override = process.env['DECKUSE_HOME']?.trim();
  if (override) return resolve(override);
  return join(homedir(), '.deckflow', 'deckuse');
}

export function monitorsRegistryDir(): string {
  return join(deckuseHome(), 'monitors');
}

export function monitorRegistrationId(workspace: string): string {
  return createHash('sha256').update(resolve(workspace)).digest('hex').slice(0, 16);
}

export function monitorRegistrationPath(workspace: string): string {
  return join(monitorsRegistryDir(), `${monitorRegistrationId(workspace)}.json`);
}

const isDaemonMeta = (value: unknown): value is DaemonMeta => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['pid'] === 'number' &&
    typeof v['host'] === 'string' &&
    typeof v['port'] === 'number' &&
    typeof v['url'] === 'string' &&
    typeof v['workspace'] === 'string' &&
    typeof v['startedAt'] === 'string'
  );
};

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const nonce = randomUUID();
  const tmp = `${path}.${nonce}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Best-effort upsert; failures are swallowed by callers when desired. */
export async function upsertMonitorRegistration(meta: DaemonMeta): Promise<void> {
  const normalized: DaemonMeta = {
    ...meta,
    workspace: resolve(meta.workspace),
  };
  await writeJsonAtomic(monitorRegistrationPath(normalized.workspace), normalized);
}

export async function removeMonitorRegistration(workspace: string): Promise<void> {
  try {
    await rm(monitorRegistrationPath(workspace), { force: true });
  } catch {
    // ignore
  }
}

export async function listMonitorRegistrations(): Promise<DaemonMeta[]> {
  const dir = monitorsRegistryDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: DaemonMeta[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(dir, name), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (isDaemonMeta(parsed)) {
        out.push({ ...parsed, workspace: resolve(parsed.workspace) });
      }
    } catch {
      // skip corrupt entries
    }
  }
  return out;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Read process command line when possible (darwin/linux). */
export async function readProcessCommandLine(pid: number): Promise<string | null> {
  if (process.platform === 'win32') return null;
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'args='], {
      encoding: 'utf8',
      timeout: 2000,
    });
    const line = stdout.trim();
    return line.length > 0 ? line : null;
  } catch {
    return null;
  }
}

/**
 * True when the PID looks like a deckuse monitor daemon-worker.
 * If cmdline cannot be read, returns null (inconclusive).
 */
export async function processLooksLikeMonitorDaemon(
  pid: number,
  workspace?: string,
): Promise<boolean | null> {
  const cmdline = await readProcessCommandLine(pid);
  if (cmdline == null) return null;
  const hasMonitor = /\bmonitor\b/.test(cmdline);
  const hasWorker = cmdline.includes('--daemon-worker');
  if (!hasMonitor || !hasWorker) return false;
  if (workspace) {
    const abs = resolve(workspace);
    // Require workspace path somewhere in argv when we know it.
    if (!cmdline.includes(abs) && !cmdline.includes(workspace)) {
      // Still accept if --workspace flag present but path differs only by trailing slash noise;
      // otherwise treat as not our monitor (PID reuse / wrong process).
      const wsMatch = cmdline.match(/--workspace\s+(\S+)/);
      if (!wsMatch?.[1]) return false;
      if (resolve(wsMatch[1]) !== abs) return false;
    }
  }
  return true;
}

export interface DiscoveredMonitor {
  readonly pid: number;
  readonly workspace: string;
  readonly host?: string;
  readonly port?: number;
}

/** Parse `ps` output for detached monitor workers (darwin/linux). */
export async function discoverMonitorsFromProcessTable(): Promise<DiscoveredMonitor[]> {
  if (process.platform === 'win32') return [];
  let stdout: string;
  try {
    const result = await execFileAsync('ps', ['-ax', '-o', 'pid=', '-o', 'command='], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch {
    return [];
  }

  const found: DiscoveredMonitor[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.includes('--daemon-worker')) continue;
    if (!/\bmonitor\b/.test(line)) continue;

    const pidMatch = line.match(/^(\d+)\s+(.*)$/);
    if (!pidMatch) continue;
    const pid = Number(pidMatch[1]);
    const cmd = pidMatch[2] ?? '';
    if (!Number.isInteger(pid) || pid <= 0) continue;

    const wsMatch = cmd.match(/--workspace(?:\s+|=)(\S+)/);
    if (!wsMatch?.[1]) continue;
    const workspace = resolve(wsMatch[1]);

    const hostMatch = cmd.match(/--host(?:\s+|=)(\S+)/);
    const portMatch = cmd.match(/--port(?:\s+|=)(\d+)/);
    found.push({
      pid,
      workspace,
      ...(hostMatch?.[1] ? { host: hostMatch[1] } : {}),
      ...(portMatch?.[1] ? { port: Number(portMatch[1]) } : {}),
    });
  }
  return found;
}
