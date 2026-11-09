import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Diagnostic } from '../core/index.js';

export const managedRetirement = () => process.env['DECKUSE_CLEANUP_MODE'] === 'retire';

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
): Promise<void> {
  if (!managedRetirement()) {
    await rm(path, { recursive, force: true });
    return;
  }
  const trash = await workspaceTrash(root);
  await rename(path, join(trash, randomUUID() + '-' + basename(path)));
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
