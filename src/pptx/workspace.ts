import { retireOwnedPath, warnCleanup } from '../workspace/cleanup.js';
import { writeApplyReceipt, type ApplyReceipt } from '../workspace/receipts.js';
import { timed } from '../timing.js';
import { withWorkspaceTransaction } from '../workspace/transaction.js';
import { withInitialization } from '../workspace/initialize.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { WorkspaceManifest } from '../core/index.js';
import { OpcArchive, snapshotArchive, type OpcArchive as OpcArchiveType } from '../opc/index.js';
import {
  appendOperationCommit,
  indexPath,
  initGitRepo,
  readManifest,
  readOperations,
  resetGit,
  sourceDir,
  withWriteLock,
  writeMetadata,
  writeOperations,
} from '../workspace/index.js';
import { loadIndex } from './index-sync.js';
import type { IndexFile } from './types.js';

const PPTX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export {
  readHistory,
  revision,
  nextRevision,
  sourceDir,
  readManifest,
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
  const { checksum } = await timed('pack', () => snapshotArchive(archive, path));
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
  onCleanupWarning?: (path: string, cause: unknown) => void,
): Promise<WorkspaceManifest> {
  const root = resolve(workspace);
  return withInitialization(
    root,
    async (root, reserve) => {
      await reserve('.deckuse', 'directory');
      await reserve('source', 'directory');
      await reserve('.git', 'directory');
      await reserve('.gitignore', 'file');
      await reserve('package.pptx', 'file');
      await archive.writeDirectoryContents(sourceDir(root));
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
    },
    onCleanupWarning,
  );
}

export async function persistWrite(
  workspace: string,
  archive: OpcArchiveType,
  manifest: WorkspaceManifest,
  index: IndexFile,
  operation: unknown,
  slides: number[],
  receipt?: Omit<ApplyReceipt, 'commitToken'>,
  changedParts = archive.getDirtyParts(),
): Promise<WorkspaceManifest> {
  const root = resolve(workspace);
  const rev = index.revision;
  const source = sourceDir(root);
  const sourceTmp = `${source}.${randomUUID()}.tmp`;
  return withWorkspaceTransaction(root, async (transactionId, prepareCommit, journal) => {
    let ownsStaging = false;
    try {
      await mkdir(sourceTmp);
      ownsStaging = true;
      await archive.writeDirectoryContents(sourceTmp);
      await timed('source-swap', async () => {
        // Keep the outgoing source inside the journal until the commit is durable.
        await rename(source, join(journal, 'retired-source'));
        await rename(sourceTmp, source);
        ownsStaging = false;
      });
      const next: WorkspaceManifest = {
        ...manifest,
        revision: rev,
        updatedAt: new Date().toISOString(),
      };
      const packed = await packPackage(root, archive, next);
      await writeMetadata(root, packed, index);
      if (receipt) await writeApplyReceipt(root, { ...receipt, commitToken: transactionId });
      await appendOperationCommit(
        root,
        {
          at: new Date().toISOString(),
          revision: rev,
          operation,
          commitToken: transactionId,
          changedParts,
          slides: [...new Set(slides)].sort((a, b) => a - b),
        },
        transactionId,
        prepareCommit,
      );
      return packed;
    } catch (error) {
      if (ownsStaging) {
        try {
          await retireOwnedPath(root, sourceTmp, true, 'source-staging');
        } catch (cause) {
          warnCleanup('SOURCE_STAGING_CLEANUP_FAILED', sourceTmp, cause);
        }
      }
      throw error;
    }
  });
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
  return withWorkspaceTransaction(root, async (_id, prepareCommit, _directory, prepareRewind) => {
    await resetGit(root, steps, prepareRewind);
    const manifest = await readManifest(root);
    const archive = await OpcArchive.openDirectory(sourceDir(root));
    const index = await loadIndex(root, archive, manifest, { persist: true });
    const packed = await packPackage(root, archive, {
      ...manifest,
      updatedAt: new Date().toISOString(),
    });
    await writeMetadata(root, packed, index);
    await prepareCommit();
    return { undone: steps, revision: index.revision };
  });
}
