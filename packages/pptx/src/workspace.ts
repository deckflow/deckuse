import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { WorkspaceManifest } from '@deckflow/deckuse-core';
import type { OpcArchive } from '@deckflow/deckuse-opc';
import { OpcArchive as OpcArchiveClass } from '@deckflow/deckuse-opc';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { IndexFile } from './types.js';

export interface OperationRecord {
  readonly at: string;
  readonly revision: string;
  readonly gitCommit: string;
  readonly operation: unknown;
  readonly slides: number[];
}

export const packagePath = (workspace: string) => join(resolve(workspace), 'package.pptx');
export const sourceDir = (workspace: string) => join(resolve(workspace), 'source');
export const deckuseDir = (workspace: string) => join(resolve(workspace), '.deckuse');
export const mediaDir = (workspace: string) => join(deckuseDir(workspace), 'media');
export const mediaHref = (workspace: string, mediaPart: string) =>
  join(mediaDir(workspace), basename(mediaPart));
export const manifestPath = (workspace: string) => join(deckuseDir(workspace), 'manifest.json');
export const indexPath = (workspace: string) => join(deckuseDir(workspace), 'index.json');
export const operationsPath = (workspace: string) => join(deckuseDir(workspace), 'operations.jsonl');
export const lockPath = (workspace: string) => join(deckuseDir(workspace), 'write.lock');
export const gitignorePath = (workspace: string) => join(resolve(workspace), '.gitignore');

const WORKSPACE_GITIGNORE = `package.*
.deckuse/write.lock
.deckuse/*.tmp
`;

export const revision = () => `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

export const readManifest = async (workspace: string): Promise<WorkspaceManifest> =>
  JSON.parse(await readFile(manifestPath(workspace), 'utf8')) as WorkspaceManifest;

export const readIndex = async (workspace: string): Promise<IndexFile> =>
  JSON.parse(await readFile(indexPath(workspace), 'utf8')) as IndexFile;

const git = (workspace: string): SimpleGit => simpleGit(resolve(workspace));

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

const readOperations = async (workspace: string): Promise<OperationRecord[]> => {
  try {
    const raw = await readFile(operationsPath(workspace), 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as OperationRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

const writeOperations = async (workspace: string, records: OperationRecord[]): Promise<void> => {
  await mkdir(deckuseDir(workspace), { recursive: true });
  const content = records.length
    ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
    : '';
  await writeFile(operationsPath(workspace), content);
};

const ensureGitignore = async (workspace: string): Promise<void> => {
  await writeFile(gitignorePath(workspace), WORKSPACE_GITIGNORE);
};

const initGit = async (workspace: string, message: string): Promise<string> => {
  const repo = git(workspace);
  if (!(await repo.checkIsRepo())) await repo.init();
  await ensureGitignore(workspace);
  await repo.add('.');
  const commit = await repo.commit(message);
  return commit.commit;
};

const commitGit = async (workspace: string, message: string): Promise<string> => {
  const repo = git(workspace);
  await repo.add('.');
  const commit = await repo.commit(message);
  return commit.commit;
};

const packPackage = async (
  workspace: string,
  archive: OpcArchive,
  manifest: WorkspaceManifest,
): Promise<WorkspaceManifest> => {
  const bytes = await archive.toUint8Array();
  const nonce = randomUUID();
  const packageTmp = `${packagePath(workspace)}.${nonce}.tmp`;
  try {
    await writeFile(packageTmp, bytes, { flag: 'wx' });
    await rename(packageTmp, packagePath(workspace));
  } catch (error) {
    await rm(packageTmp, { force: true });
    throw error;
  }
  return {
    ...manifest,
    files: [
      {
        path: basename(packagePath(workspace)),
        mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        checksum: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
  };
};

const writeMetadata = async (
  workspace: string,
  manifest: WorkspaceManifest,
  index: IndexFile,
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

export async function initializeWorkspace(
  workspace: string,
  archive: OpcArchive,
  manifest: WorkspaceManifest,
  index: IndexFile,
): Promise<WorkspaceManifest> {
  const root = resolve(workspace);
  await mkdir(root, { recursive: true });
  await mkdir(deckuseDir(root), { recursive: true });
  const source = sourceDir(root);
  await archive.writeDirectory(source, true);
  await extractMedia(root, archive);
  const packed = await packPackage(root, archive, manifest);
  const next: WorkspaceManifest = {
    ...packed,
    revision: index.revision,
    updatedAt: new Date().toISOString(),
  };
  await writeMetadata(root, next, index);
  await writeOperations(root, []);
  await initGit(root, 'deckuse: init');
  return next;
}

export async function persistWrite(
  workspace: string,
  archive: OpcArchive,
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
    await extractMedia(root, archive);
    const next: WorkspaceManifest = {
      ...manifest,
      revision: rev,
      updatedAt: new Date().toISOString(),
    };
    const packed = await packPackage(root, archive, next);
    await writeMetadata(root, packed, index);
    const records = await readOperations(root);
    records.push({
      at: new Date().toISOString(),
      revision: rev,
      gitCommit: '',
      operation,
      slides: [...new Set(slides)].sort((a, b) => a - b),
    });
    await writeOperations(root, records);
    const gitCommit = await commitGit(root, operationCommitMessage(operation));
    const last = records.at(-1);
    if (last) records[records.length - 1] = { ...last, gitCommit };
    await writeOperations(root, records);
    return packed;
  } catch (error) {
    await rm(sourceTmp, { recursive: true, force: true });
    throw error;
  }
}

const operationCommitMessage = (operation: unknown): string => {
  if (typeof operation === 'object' && operation !== null) {
    const type = (operation as Record<string, unknown>)['type'];
    if (typeof type === 'string') return `deckuse: ${type}`;
  }
  return 'deckuse: write';
};

export async function undoWrites(
  workspace: string,
  steps: number,
): Promise<{ undone: number; revision: string }> {
  const root = resolve(workspace);
  const records = await readOperations(root);
  if (steps > records.length)
    throw new Error(`Cannot undo ${String(steps)} step(s); only ${String(records.length)} available`);
  await git(root).reset(['--hard', `HEAD~${String(steps)}`]);
  const manifest = await readManifest(root);
  const index = await readIndex(root);
  const archive = await OpcArchiveClass.openDirectory(sourceDir(root));
  await packPackage(root, archive, manifest);
  return { undone: steps, revision: index.revision };
}

export async function readHistory(
  workspace: string,
  limit: number,
  offset: number,
): Promise<{ records: OperationRecord[]; total: number }> {
  const records = await readOperations(workspace);
  return { records: records.slice(offset, offset + limit), total: records.length };
}
