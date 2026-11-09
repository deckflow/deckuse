import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { managedRetirement, retireOwnedPath, warnCleanup, workspaceTrash } from './cleanup.js';
import { timed } from '../timing.js';
import { requireDefined } from '../required.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { resolve } from 'node:path';
import { lstat, mkdir, open, readFile, stat } from 'node:fs/promises';
import { deckuseDir, lockPath } from './paths.js';

const LOCK_WAIT_MS = 30_000;
const LOCK_POLL_MS = 50;

export class WorkspaceLockError extends Error {
  constructor(
    readonly path: string,
    readonly stage: 'wait' | 'reclaim',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

interface LockPayload {
  pid: number;
  acquiredAt: number;
  token?: string;
}

export const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};

export const parseLockPayload = (raw: string): LockPayload | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const value = JSON.parse(trimmed) as Partial<LockPayload>;
    if (!Number.isInteger(value.pid) || requireDefined(value.pid) <= 0) return undefined;
    if (!Number.isFinite(value.acquiredAt)) return undefined;
    return {
      pid: requireDefined(value.pid),
      acquiredAt: requireDefined(value.acquiredAt),
      ...(typeof value.token === 'string' ? { token: value.token } : {}),
    };
  } catch {
    return undefined;
  }
};

/** Reclaim only a specific lock generation with a confirmed dead PID. */
const reclaimIfStale = async (path: string): Promise<boolean> => {
  let raw: string;
  let initial: Awaited<ReturnType<typeof stat>>;
  try {
    initial = await stat(path);
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
  const payload = parseLockPayload(raw);
  if (!payload || isProcessAlive(payload.pid)) return false;
  const root = dirname(dirname(path));
  // Claim this specific stale generation. Only the claimant can retire it.
  const key = createHash('sha256')
    .update(JSON.stringify([initial.dev, initial.ino, initial.ctimeMs, raw]))
    .digest('hex');
  const claims = join(await workspaceTrash(root), 'lock-claims');
  await mkdir(claims, { recursive: true });
  if (!(await lstat(claims)).isDirectory()) throw new Error('Invalid stale-lock claim directory');
  try {
    await (await open(join(claims, key), 'wx')).close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  const current = await stat(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  if (!current) return true;
  if (
    current.dev !== initial.dev ||
    current.ino !== initial.ino ||
    current.ctimeMs !== initial.ctimeMs ||
    (await readFile(path, 'utf8')) !== raw ||
    isProcessAlive(payload.pid)
  )
    return false;
  try {
    await timed('cleanup-lock-reclaim', () => retireOwnedPath(root, path));
  } catch (cause) {
    throw new WorkspaceLockError(
      path,
      'reclaim',
      'Could not reclaim the workspace write lock. Preserve it and use status --read-only.',
      { cause },
    );
  }
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
  managedRetirement();
  await mkdir(deckuseDir(workspace), { recursive: true });
  const path = lockPath(workspace);
  const deadline = Date.now() + LOCK_WAIT_MS;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  const payload: LockPayload = { pid: process.pid, acquiredAt: Date.now(), token: randomUUID() };
  while (Date.now() < deadline) {
    try {
      handle = await open(path, 'wx');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await reclaimIfStale(path)) continue;
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
  if (!handle) {
    throw new WorkspaceLockError(
      path,
      'wait',
      'Timed out waiting for workspace write lock. Preserve it and use status --read-only to reconcile the request.',
    );
  }
  try {
    await handle.writeFile(`${JSON.stringify(payload)}\n`);
    const acquired = await handle.stat();
    return async () => {
      await handle.close();
      const current = await lstat(path);
      if (
        current.dev !== acquired.dev ||
        current.ino !== acquired.ino ||
        parseLockPayload(await readFile(path, 'utf8'))?.token !== payload.token
      )
        throw new Error('Workspace write lock ownership changed');
      await timed('cleanup-lock-release', () => retireOwnedPath(workspace, path));
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
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
    try {
      await release();
    } catch (cause) {
      warnCleanup('WRITE_LOCK_CLEANUP_FAILED', lockPath(workspace), cause);
    }
  }
};
