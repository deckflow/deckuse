import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { WorkspaceManifest } from '@deckflow/deckuse-core';
import { deckuseDir, indexPath, manifestPath } from './paths.js';

export const readManifest = async (workspace: string): Promise<WorkspaceManifest> =>
  JSON.parse(await readFile(manifestPath(workspace), 'utf8')) as WorkspaceManifest;

export const writeMetadata = async (
  workspace: string,
  manifest: WorkspaceManifest,
  index: unknown,
): Promise<void> => {
  await mkdir(deckuseDir(workspace), { recursive: true });
  const nonce = randomUUID();
  const indexTmp = `${indexPath(workspace)}.${nonce}.tmp`;
  const manifestTmp = `${manifestPath(workspace)}.${nonce}.tmp`;
  try {
    await writeFile(indexTmp, `${JSON.stringify(index, null, 2)}\n`, { flag: 'wx' });
    await writeFile(manifestTmp, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await rename(indexTmp, indexPath(workspace));
    await rename(manifestTmp, manifestPath(workspace));
  } catch (error) {
    await Promise.all([rm(indexTmp, { force: true }), rm(manifestTmp, { force: true })]);
    throw error;
  }
};
