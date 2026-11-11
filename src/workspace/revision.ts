import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Monotonic integer revision as a decimal string (index/manifest stay string-typed). */
export const INITIAL_REVISION = '1';

export const revision = (): string => INITIAL_REVISION;

export const nextRevision = (current: string): string => {
  const n = Number(current);
  if (Number.isSafeInteger(n) && n >= 0) return String(n + 1);
  // Legacy non-integer revisions: start a new integer line after the write.
  return INITIAL_REVISION;
};

export const isIntegerRevision = (value: string): boolean => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 && String(n) === value;
};

const highWaterPath = (workspace: string) => join(workspace, '.git', 'deckuse-revision');
async function highWaterRevision(workspace: string): Promise<number> {
  try {
    const value = (await readFile(highWaterPath(workspace), 'utf8')).trim();
    if (!isIntegerRevision(value)) throw new Error('Invalid reserved workspace revision');
    return Number(value);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw cause;
  }
}

/** Caller holds the workspace lock. Reserve the discarded revision before rewinding. */
export async function reserveUndoRevision(workspace: string, current: string): Promise<void> {
  if (Number(current) <= (await highWaterRevision(workspace))) return;
  const destination = highWaterPath(workspace);
  const staging = `${destination}.${randomUUID()}.tmp`;
  await writeFile(staging, current + '\n', { flag: 'wx' });
  await rename(staging, destination);
}

export async function nextWorkspaceRevision(workspace: string, current: string): Promise<string> {
  return nextRevision(String(Math.max(Number(current), await highWaterRevision(workspace))));
}
