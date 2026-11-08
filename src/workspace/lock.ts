import { timed } from '../timing.js';
import { requireDefined } from '../required.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { resolve } from 'node:path';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { deckuseDir, lockPath } from './paths.js';

const LOCK_WAIT_MS = 30_000;
const LOCK_POLL_MS = 50;
const LOCK_INITIALIZING_MS = 500;

interface LockPayload {
  pid: number;
  acquiredAt: number;
}

const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};

const parseLockPayload = (raw: string): LockPayload | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const value = JSON.parse(trimmed) as Partial<LockPayload>;
    if (!Number.isInteger(value.pid) || requireDefined(value.pid) <= 0) return undefined;
    if (!Number.isFinite(value.acquiredAt)) return undefined;
    return { pid: requireDefined(value.pid), acquiredAt: requireDefined(value.acquiredAt) };
  } catch {
    return undefined;
  }
};

/** Remove lock if missing holder / dead PID. Returns true when the path is free. */
const reclaimIfStale = async (path: string): Promise<boolean> => {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
  const payload = parseLockPayload(raw);
  if (payload && isProcessAlive(payload.pid)) return false;
  if (!payload && !raw.trim()) {
    // An exclusive open creates an empty file before the holder writes its PID.
    try {
      if (Date.now() - (await stat(path)).mtimeMs < LOCK_INITIALIZING_MS) return false;
      if ((await readFile(path, 'utf8')).trim()) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw error;
    }
  }
  await timed('cleanup-lock-reclaim', () => rm(path, { force: true }));
  return true;
};

/** A freshly created empty file can be a lock whose holder is writing its PID. */
export const isWriteLockHeld = async (workspace: string): Promise<boolean> => {
  const path = lockPath(workspace);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  const payload = parseLockPayload(raw);
  if (payload && isProcessAlive(payload.pid)) return true;
  return !(await reclaimIfStale(path));
};

export const acquireWriteLock = async (workspace: string): Promise<() => Promise<void>> => {
  await mkdir(deckuseDir(workspace), { recursive: true });
  const path = lockPath(workspace);
  const deadline = Date.now() + LOCK_WAIT_MS;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  while (Date.now() < deadline) {
    try {
      handle = await open(path, 'wx');
      const payload: LockPayload = { pid: process.pid, acquiredAt: Date.now() };
      await handle.writeFile(`${JSON.stringify(payload)}\n`);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await reclaimIfStale(path)) continue;
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
  if (!handle) {
    throw new Error(
      'Timed out waiting for workspace write lock. If no other deckuse process is running, remove .deckuse/write.lock and retry.',
    );
  }
  return async () => {
    await handle.close();
    await timed('cleanup-lock-release', () => rm(path, { force: true }));
  };
};

const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>();

export const withWriteLock = async <T>(
  workspace: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const key = resolve(workspace);
  const held = heldLocks.getStore();
  if (held?.has(key)) return operation();
  const release = await timed('lock-wait', () => acquireWriteLock(workspace));
  try {
    return await heldLocks.run(new Set([...(held ?? []), key]), operation);
  } finally {
    await release();
  }
};
