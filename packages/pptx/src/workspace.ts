import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorkspaceManifest } from '@deckflow/deckuse-core';
import { OpcArchive, snapshotArchive, type OpcArchive as OpcArchiveType } from '@deckflow/deckuse-opc';
import {
  appendOperationCommit,
  deckuseDir,
  indexPath,
  initGitRepo,
  readHistory,
  readManifest,
  readOperations,
  resetGit,
  revision,
  sourceDir,
  withWriteLock,
  writeMetadata,
  writeOperations,
} from '@deckflow/deckuse-workspace';
import { loadIndex } from './index-sync.js';
import type { IndexFile } from './types.js';

const PPTX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export {
  revision,
  nextRevision,
  sourceDir,
  readManifest,
  readHistory,
  withWriteLock,
} from '@deckflow/deckuse-workspace';
export type { OperationRecord } from '@deckflow/deckuse-workspace';

export const packagePath = (workspace: string) => join(resolve(workspace), 'package.pptx');
export const mediaHref = (workspace: string, mediaPart: string) =>
  join(sourceDir(workspace), mediaPart.replace(/^\//, ''));

export const readIndex = async (workspace: string): Promise<IndexFile> =>
  JSON.parse(await readFile(indexPath(workspace), 'utf8')) as IndexFile;

const packPackage = async (
  workspace: string,
  archive: OpcArchiveType,
  manifest: WorkspaceManifest,
): Promise<WorkspaceManifest> => {
  const path = packagePath(workspace);
  const { checksum } = await snapshotArchive(archive, path);
  return {
    ...manifest,
    files: [
      {
        path: basename(path),
        mediaType: PPTX_MEDIA_TYPE,
        checksum,
      },
    ],
  };
};

export async function initializeWorkspace(
  workspace: string,
  archive: OpcArchiveType,
  manifest: WorkspaceManifest,
  index: IndexFile,
): Promise<WorkspaceManifest> {
  const root = resolve(workspace);
  await mkdir(root, { recursive: true });
  await mkdir(deckuseDir(root), { recursive: true });
  await archive.writeDirectory(sourceDir(root), true);
  const packed = await packPackage(root, archive, manifest);
  const next: WorkspaceManifest = {
    ...packed,
    revision: index.revision,
    updatedAt: new Date().toISOString(),
  };
  await writeMetadata(root, next, index);
  await writeOperations(root, []);
  await initGitRepo(root, 'deckuse: init');
  return next;
}

export async function persistWrite(
  workspace: string,
  archive: OpcArchiveType,
  manifest: WorkspaceManifest,
  index: IndexFile,
  operation: unknown,
  slides: number[],
): Promise<WorkspaceManifest> {
  const root = resolve(workspace);
  const rev = index.revision;
  const source = sourceDir(root);
  const sourceTmp = `${source}.${randomUUID()}.tmp`;
  try {
    await archive.writeDirectory(sourceTmp);
    await rm(source, { recursive: true, force: true });
    await rename(sourceTmp, source);
    const next: WorkspaceManifest = {
      ...manifest,
      revision: rev,
      updatedAt: new Date().toISOString(),
    };
    const packed = await packPackage(root, archive, next);
    await writeMetadata(root, packed, index);
    await appendOperationCommit(root, {
      at: new Date().toISOString(),
      revision: rev,
      operation,
      slides: [...new Set(slides)].sort((a, b) => a - b),
    });
    return packed;
  } catch (error) {
    await rm(sourceTmp, { recursive: true, force: true });
    throw error;
  }
}

export async function undoWrites(
  workspace: string,
  steps: number,
): Promise<{ undone: number; revision: string }> {
  const root = resolve(workspace);
  const records = await readOperations(root);
  if (steps > records.length)
    throw new Error(`Cannot undo ${String(steps)} step(s); only ${String(records.length)} available`);
  await resetGit(root, steps);
  const manifest = await readManifest(root);
  const archive = await OpcArchive.openDirectory(sourceDir(root));
  const index = await loadIndex(root, archive, manifest, { persist: true });
  await packPackage(root, archive, manifest);
  return { undone: steps, revision: index.revision };
}
