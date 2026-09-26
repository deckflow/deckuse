import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { deckuseDir, lockPath } from './paths.js';

const LOCK_WAIT_MS = 30_000;
const LOCK_POLL_MS = 50;

type LockPayload = {
  pid: number;
  acquiredAt: number;
};

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
    if (!Number.isInteger(value.pid) || (value.pid as number) <= 0) return undefined;
    if (!Number.isFinite(value.acquiredAt)) return undefined;
    return { pid: value.pid as number, acquiredAt: value.acquiredAt as number };
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
  await rm(path, { force: true });
  return true;
};

/** True when a live process holds the write lock (stale/empty files count as unlocked). */
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
  await rm(path, { force: true });
  return false;
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
    await rm(path, { force: true });
  };
};

export const withWriteLock = async <T>(
  workspace: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const release = await acquireWriteLock(workspace);
  try {
    return await operation();
  } finally {
    await release();
  }
};
