import { mkdir, open, readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

export class WorkspaceNotEmptyError extends Error {
  constructor() {
    super(
      'Workspace destination must be absent or empty; choose a new directory or continue using the existing workspace.',
    );
  }
}

type ReserveEntry = (name: string, kind: 'directory' | 'file') => Promise<string>;

/** Write directly under a destination reservation; roll back only reserved entries. */
export async function withInitialization<T>(
  root: string,
  initialize: (root: string, reserve: ReserveEntry) => Promise<T>,
): Promise<T> {
  await mkdir(root, { recursive: true });
  const marker = join(root, '.deckuse-init.lock');
  let lock;
  try {
    lock = await open(marker, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new WorkspaceNotEmptyError();
    throw error;
  }
  const owned: string[] = [];
  const reserve: ReserveEntry = async (name, kind) => {
    if (
      !name ||
      basename(name) !== name ||
      name === '.' ||
      name === '..' ||
      name === '.deckuse-init.lock'
    )
      throw new Error('Initialization entries must be top-level workspace paths');
    const path = join(root, name);
    try {
      if (kind === 'directory') {
        await mkdir(path);
        owned.push(path);
      } else {
        const handle = await open(path, 'wx');
        owned.push(path);
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new WorkspaceNotEmptyError();
      throw error;
    }
    return path;
  };
  try {
    if ((await readdir(root)).some((entry) => entry !== '.deckuse-init.lock'))
      throw new WorkspaceNotEmptyError();
    return await initialize(root, reserve);
  } catch (error) {
    for (const path of owned.reverse()) await rm(path, { recursive: true, force: true });
    throw error;
  } finally {
    await lock.close();
    await rm(marker, { force: true });
  }
}
