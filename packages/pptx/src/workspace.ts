import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { WorkspaceManifest } from '@deckflow/deckuse-core';
import type { OpcArchive } from '@deckflow/deckuse-opc';
import type { IndexFile } from './types.js';
export const packagePath = (workspace: string) => join(resolve(workspace), 'package.pptx');
export const deckuseDir = (workspace: string) => join(resolve(workspace), '.deckuse');
export const mediaDir = (workspace: string) => join(deckuseDir(workspace), 'media');
export const mediaHref = (workspace: string, mediaPart: string) =>
  join(mediaDir(workspace), basename(mediaPart));
export const manifestPath = (workspace: string) => join(deckuseDir(workspace), 'manifest.json');
export const indexPath = (workspace: string) => join(deckuseDir(workspace), 'index.json');
export const operationsPath = (workspace: string) =>
  join(deckuseDir(workspace), 'operations.jsonl');
export const revision = () => `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
export const readManifest = async (workspace: string): Promise<WorkspaceManifest> =>
  JSON.parse(await readFile(manifestPath(workspace), 'utf8')) as WorkspaceManifest;
export const readIndex = async (workspace: string): Promise<IndexFile> =>
  JSON.parse(await readFile(indexPath(workspace), 'utf8')) as IndexFile;
const extractMedia = async (workspace: string, archive: OpcArchive): Promise<void> => {
  const dir = mediaDir(workspace);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await Promise.all(
    [...archive.parts.values()]
      .filter((part) => part.name.startsWith('/ppt/media/'))
      .map((part) => writeFile(join(dir, basename(part.name)), part.data)),
  );
};
export async function persist(
  workspace: string,
  archive: OpcArchive,
  manifest: WorkspaceManifest,
  index: IndexFile,
  operation?: unknown,
): Promise<WorkspaceManifest> {
  await mkdir(deckuseDir(workspace), { recursive: true });
  const rev = index.revision;
  const packageBytes = await archive.toUint8Array();
  const next: WorkspaceManifest = {
    ...manifest,
    revision: rev,
    updatedAt: new Date().toISOString(),
    files: [
      {
        path: 'package.pptx',
        mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        checksum: createHash('sha256').update(packageBytes).digest('hex'),
      },
    ],
  };
  const nonce = randomUUID();
  const packageTmp = `${packagePath(workspace)}.${nonce}.tmp`,
    indexTmp = `${indexPath(workspace)}.${nonce}.tmp`,
    manifestTmp = `${manifestPath(workspace)}.${nonce}.tmp`;
  try {
    await Promise.all([
      writeFile(packageTmp, packageBytes, { flag: 'wx' }),
      writeFile(indexTmp, `${JSON.stringify(index, null, 2)}\n`, { flag: 'wx' }),
      writeFile(manifestTmp, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' }),
    ]);
    await rename(packageTmp, packagePath(workspace));
    await rename(indexTmp, indexPath(workspace));
    await rename(manifestTmp, manifestPath(workspace));
    await extractMedia(workspace, archive);
    if (operation)
      await writeFile(
        operationsPath(workspace),
        `${JSON.stringify({ at: new Date().toISOString(), revision: rev, operation })}\n`,
        { flag: 'a' },
      );
    return next;
  } catch (error) {
    await Promise.all([
      rm(packageTmp, { force: true }),
      rm(indexTmp, { force: true }),
      rm(manifestTmp, { force: true }),
    ]);
    throw error;
  }
}
