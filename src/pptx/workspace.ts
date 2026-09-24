import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { WorkspaceManifest } from '../core/index.js';
import { OpcArchive, snapshotArchive, type OpcArchive as OpcArchiveType } from '../opc/index.js';
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
} from '../workspace/index.js';
import { loadIndex } from './index-sync.js';
import type { IndexFile } from './types.js';

const PPTX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export {
  revision,
  nextRevision,
  sourceDir,
  readManifest,
  readHistory,
  withWriteLock,
} from '../workspace/index.js';
export type { OperationRecord } from '../workspace/index.js';

export const packagePath = (workspace: string) => join(resolve(workspace), 'package.pptx');
export const mediaHref = (workspace: string, mediaPart: string) =>
  join(sourceDir(workspace), mediaPart.replace(/^\//, ''));

export const readIndex = async (workspace: string): Promise<IndexFile> =>
  JSON.parse(await readFile(indexPath(workspace), 'utf8')) as IndexFile;

/** Stable hash of all files under `source/` (path + bytes, sorted). */
export async function hashSourceTree(workspace: string): Promise<string> {
  const root = sourceDir(workspace);
  const entries: { relative: string; data: Buffer }[] = [];
  const walk = async (dir: string, prefix = ''): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, relative);
        continue;
      }
      if (!entry.isFile()) continue;
      entries.push({ relative: relative.replaceAll('\\', '/'), data: await readFile(absolute) });
    }
  };
  await walk(root);
  entries.sort((a, b) => a.relative.localeCompare(b.relative));
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(entry.relative);
    hash.update('\0');
    hash.update(entry.data);
  }
  return hash.digest('hex');
}

const withSourceContentHash = async (
  workspace: string,
  manifest: WorkspaceManifest,
): Promise<WorkspaceManifest> => {
  const sourceContentHash = await hashSourceTree(workspace);
  return {
    ...manifest,
    metadata: {
      ...(manifest.metadata ?? {}),
      sourceContentHash,
    },
  };
};

export const isPackageStale = async (
  workspace: string,
  manifest?: WorkspaceManifest,
): Promise<boolean> => {
  const current = manifest ?? (await readManifest(workspace));
  const stored = current.metadata?.['sourceContentHash'];
  if (typeof stored !== 'string' || stored.length === 0) return false;
  const live = await hashSourceTree(workspace);
  return live !== stored;
};

const packPackage = async (
  workspace: string,
  archive: OpcArchiveType,
  manifest: WorkspaceManifest,
): Promise<WorkspaceManifest> => {
  const path = packagePath(workspace);
  const { checksum } = await snapshotArchive(archive, path);
  const withFiles: WorkspaceManifest = {
    ...manifest,
    files: [
      {
        path: basename(path),
        mediaType: PPTX_MEDIA_TYPE,
        checksum,
      },
    ],
  };
  return withSourceContentHash(workspace, withFiles);
};

/** Rebuild `package.pptx` from `source/` and refresh manifest checksum + source hash. */
export async function repackWorkspace(workspace: string): Promise<{
  manifest: WorkspaceManifest;
  packagePath: string;
}> {
  const root = resolve(workspace);
  return withWriteLock(root, async () => {
    const manifest = await readManifest(root);
    const archive = await OpcArchive.openDirectory(sourceDir(root));
    const index = await loadIndex(root, archive, manifest, { persist: true });
    const packed = await packPackage(root, archive, {
      ...manifest,
      updatedAt: new Date().toISOString(),
    });
    await writeMetadata(root, packed, index);
    return { manifest: packed, packagePath: packagePath(root) };
  });
}

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
    throw new Error(
      `Cannot undo ${String(steps)} step(s); only ${String(records.length)} available`,
    );
  await resetGit(root, steps);
  const manifest = await readManifest(root);
  const archive = await OpcArchive.openDirectory(sourceDir(root));
  const index = await loadIndex(root, archive, manifest, { persist: true });
  const packed = await packPackage(root, archive, {
    ...manifest,
    updatedAt: new Date().toISOString(),
  });
  await writeMetadata(root, packed, index);
  return { undone: steps, revision: index.revision };
}
