import { mkdir, mkdtemp, open, readdir, rename, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';

export class WorkspaceNotEmptyError extends Error {
  constructor() {
    super(
      'Workspace destination must be absent or empty; choose a new directory or continue using the existing workspace.',
    );
  }
}

/** Initialize privately, then publish only owned entries under a destination reservation. */
export async function withInitialization<T>(
  root: string,
  initialize: (staging: string) => Promise<T>,
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
  let staging: string | undefined;
  const published: string[] = [];
  try {
    if ((await readdir(root)).some((entry) => entry !== '.deckuse-init.lock'))
      throw new WorkspaceNotEmptyError();
    staging = await mkdtemp(join(root, '.deckuse-init-content-'));
    const result = await initialize(staging);
    for (const entry of await readdir(staging)) {
      const destination = join(root, entry);
      let present = false;
      try {
        await lstat(destination);
        present = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (present) throw new WorkspaceNotEmptyError();
      await rename(join(staging, entry), destination);
      published.push(destination);
    }
    return result;
  } catch (error) {
    for (const path of published) await rm(path, { recursive: true, force: true });
    throw error;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await lock.close();
    await rm(marker, { force: true });
  }
}
