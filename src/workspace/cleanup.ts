import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { Diagnostic } from '../core/index.js';

export function managedRetirement(): boolean {
  const mode = process.env['DECKUSE_CLEANUP_MODE'];
  if (mode === undefined || mode === 'retire') return true;
  if (mode === 'delete') return false;
  throw new Error('DECKUSE_CLEANUP_MODE must be delete or retire');
}

export interface CleanupRetirement {
  originalPath: string;
  retiredPath: string;
  category: string;
}

const cleanupReports = new AsyncLocalStorage<CleanupRetirement[]>();
export const collectCleanupRetirements = cleanupReports.run.bind(cleanupReports);

export async function workspaceTrash(root: string): Promise<string> {
  const trash = join(root, '.deckuse-trash');
  await mkdir(trash, { recursive: true });
  if (!(await lstat(trash)).isDirectory())
    throw new Error('Retirement path is not a workspace-owned directory');
  return trash;
}

/** Caller has exclusive ownership of the path and has verified it is disposable. */
export async function retireOwnedPath(
  root: string,
  path: string,
  recursive = false,
  category = basename(path),
): Promise<void> {
  if (!managedRetirement()) {
    await rm(path, { recursive, force: true });
    return;
  }
  const relativeParent = relative(await realpath(root), await realpath(dirname(path)));
  if (
    isAbsolute(relativeParent) ||
    relativeParent === '..' ||
    relativeParent.startsWith('..' + sep)
  )
    throw new Error('Retirement target is outside the workspace');
  const trash = await workspaceTrash(root);
  const retiredPath = join(trash, randomUUID() + '-' + basename(path));
  await rename(path, retiredPath);
  cleanupReports.getStore()?.push({ originalPath: path, retiredPath, category });
}

const cleanupWarnings = new AsyncLocalStorage<Diagnostic[]>();
export const collectCleanupWarnings = cleanupWarnings.run.bind(cleanupWarnings);

export function warnCleanup(code: string, path: string, cause: unknown) {
  const message = `Could not release Deckuse-owned state at ${path}: ${String(cause)}`;
  const warning: Diagnostic = {
    severity: 'warning',
    code,
    message,
    details: {
      path,
      action: 'Preserve this path. Reconcile status and the request receipt before retrying.',
    },
  };
  cleanupWarnings.getStore()?.push(warning);
  process.stderr.write(`deckuse: ${code}: ${message}\n`);
}
