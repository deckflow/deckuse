import { managedRetirement, retireOwnedPath } from './cleanup.js';
import { lstat, mkdir, open, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

export class WorkspaceNotEmptyError extends Error {
  constructor() {
    super(
      'Workspace destination must be absent or empty; choose a new directory or continue using the existing workspace.',
    );
  }
}

export async function initializationState(root: string) {
  const marker = join(root, '.deckuse-init.lock');
  try {
    const value = await readFile(marker, 'utf8');
    return {
      state: value === 'committed' ? 'committed-with-cleanup-warning' : 'initialization-incomplete',
      marker,
    };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw cause;
  }
}

type ReserveEntry = (name: string, kind: 'directory' | 'file') => Promise<string>;

/** Write directly under a destination reservation; roll back only reserved entries. */
export async function withInitialization<T>(
  root: string,
  initialize: (root: string, reserve: ReserveEntry) => Promise<T>,
  onCleanupWarning?: (path: string, cause: unknown) => void,
): Promise<T> {
  managedRetirement();
  await mkdir(root, { recursive: true });
  const marker = join(root, '.deckuse-init.lock');
  let lock;
  try {
    lock = await open(marker, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new WorkspaceNotEmptyError();
    throw error;
  }
  const markerIdentity = await lock.stat();
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
  let preserveMarker = false;
  try {
    if ((await readdir(root)).some((entry) => entry !== '.deckuse-init.lock'))
      throw new WorkspaceNotEmptyError();
    const result = await initialize(root, reserve);
    try {
      await lock.writeFile('committed');
      await lock.sync();
    } catch (cause) {
      onCleanupWarning?.(marker, cause);
    }
    return result;
  } catch (error) {
    for (const path of owned.reverse()) {
      try {
        await retireOwnedPath(root, path, true, 'initialization-rollback');
      } catch (cause) {
        preserveMarker = true;
        onCleanupWarning?.(path, cause);
      }
    }
    if (preserveMarker)
      throw new Error(
        `Initialization did not complete and cleanup was denied. Keep ${root} for inspection and initialize in a fresh directory.`,
        { cause: error },
      );
    throw error;
  } finally {
    try {
      await lock.close();
      if (!preserveMarker) {
        const current = await lstat(marker);
        if (current.dev === markerIdentity.dev && current.ino === markerIdentity.ino)
          await retireOwnedPath(root, marker);
        else
          onCleanupWarning?.(
            marker,
            new Error('Workspace initialization marker ownership changed'),
          );
      }
    } catch (cause) {
      onCleanupWarning?.(marker, cause);
    }
  }
}
