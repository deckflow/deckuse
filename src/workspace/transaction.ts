import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import fs from 'node:fs';
import { log } from 'isomorphic-git';
import { ensureGitignore } from './git.js';

export class RecoveryRequiredError extends Error {
  override name = 'RecoveryRequiredError';
}
const paths = [
  '.gitignore',
  'source',
  'package.pptx',
  'package.docx',
  '.deckuse/manifest.json',
  '.deckuse/index.json',
  '.deckuse/operations.jsonl',
  '.git/index',
  '.git/index.lock',
  '.git/HEAD.lock',
  '.git/HEAD',
  '.git/refs',
];
const directory = (root: string) => join(root, '.deckuse/transaction');
async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}
async function digest(root: string, includeGit = false) {
  const hash = createHash('sha256');
  async function walk(path: string, relative: string): Promise<void> {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort())
        await walk(join(path, name), `${relative}/${name}`);
    } else {
      hash.update(`${relative}\0`);
      hash.update(
        createHash('sha256')
          .update(await readFile(path))
          .digest(),
      );
    }
  }
  for (const path of paths.filter((p) => includeGit || !p.startsWith('.git/')))
    if (await exists(join(root, path))) await walk(join(root, path), path);
  return hash.digest('hex');
}
interface Journal {
  id: string;
  present: string[];
  target?: string;
  previousCommit?: string;
  backupHash?: string;
}
export async function recoverTransaction(root: string): Promise<void> {
  const dir = directory(root);
  if (!(await exists(dir))) return;
  try {
    const journal = JSON.parse(await readFile(join(dir, 'journal.json'), 'utf8')) as Journal;
    if (!Array.isArray(journal.present) || journal.present.some((p) => !paths.includes(p)))
      throw new Error('Invalid transaction backup');
    let committed = false;
    let changedHead = false;
    try {
      const history = await log({ fs, dir: root, depth: 1 });
      changedHead = Boolean(journal.previousCommit && history[0]?.oid !== journal.previousCommit);
      committed = Boolean(
        journal.target &&
        history[0]?.commit.message.includes(`Deckuse-Transaction: ${journal.id}`) &&
        (await digest(root)) === journal.target,
      );
    } catch {
      /* Restore the backup when commit cannot be verified. */
    }
    if (!committed && changedHead)
      throw new Error('Git HEAD changed and the target digest cannot be verified');
    if (!committed) {
      if (!journal.backupHash || (await digest(join(dir, 'backup'), true)) !== journal.backupHash)
        throw new Error('Transaction backup checksum mismatch');
      for (const path of journal.present)
        if (!(await exists(join(dir, 'backup', path)))) throw new Error(`Missing backup: ${path}`);
      for (const path of paths) {
        await rm(join(root, path), { recursive: true, force: true });
        if (journal.present.includes(path)) {
          await mkdir(join(root, path, '..'), { recursive: true });
          await cp(join(dir, 'backup', path), join(root, path), { recursive: true });
        }
      }
    }
    await rm(dir, { recursive: true, force: true });
  } catch (cause) {
    throw new RecoveryRequiredError(
      `Workspace recovery required; preserve ${dir}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}
/** Caller holds the workspace lock. Back up actual working files, including dirty edits. */
export async function withWorkspaceTransaction<T>(
  root: string,
  action: (id: string, prepareCommit: () => Promise<void>) => Promise<T>,
): Promise<T> {
  await recoverTransaction(root);
  const dir = directory(root);
  const staging = `${dir}.${randomUUID()}.tmp`;
  const journal: Journal = { id: randomUUID(), present: [] };
  try {
    const head = (await log({ fs, dir: root, depth: 1 }))[0]?.oid;
    if (head) journal.previousCommit = head;
  } catch {
    /* Missing Git will fail the commit and restore the working files. */
  }
  await mkdir(join(staging, 'backup'), { recursive: true });
  try {
    for (const path of paths)
      if (await exists(join(root, path))) {
        journal.present.push(path);
        await mkdir(join(staging, 'backup', path, '..'), { recursive: true });
        await cp(join(root, path), join(staging, 'backup', path), { recursive: true });
      }
    journal.backupHash = await digest(join(staging, 'backup'), true);
    await writeFile(join(staging, 'journal.json'), JSON.stringify(journal));
    await rename(staging, dir);
  } catch (e) {
    await rm(staging, { recursive: true, force: true });
    throw e;
  }
  const prepareCommit = async () => {
    journal.target = await digest(root);
    await writeFile(join(dir, 'journal.next'), JSON.stringify(journal));
    await rename(join(dir, 'journal.next'), join(dir, 'journal.json'));
  };
  try {
    await ensureGitignore(root);
    const result = await action(journal.id, prepareCommit);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      /* The commit succeeded; retry journal cleanup on the next locked access. */
    }
    return result;
  } catch (e) {
    await recoverTransaction(root);
    throw e;
  }
}

export async function historyHealth(root: string) {
  try {
    const commits = await log({ fs, dir: root });
    return {
      recovery: 'clean',
      history: 'available',
      commit: commits[0]?.oid,
      undoSteps: Math.max(0, commits.length - 1),
    };
  } catch (cause) {
    return {
      recovery: 'clean',
      history: 'unavailable',
      undoSteps: 0,
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
