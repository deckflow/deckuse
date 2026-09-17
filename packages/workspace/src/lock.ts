import { mkdir, open, rm } from 'node:fs/promises';
import { deckuseDir, lockPath } from './paths.js';

export const acquireWriteLock = async (workspace: string): Promise<() => Promise<void>> => {
  await mkdir(deckuseDir(workspace), { recursive: true });
  const path = lockPath(workspace);
  const deadline = Date.now() + 30_000;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  while (Date.now() < deadline) {
    try {
      handle = await open(path, 'wx');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!handle) throw new Error('Timed out waiting for workspace write lock');
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
