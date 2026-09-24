import fs from 'node:fs';
import { access, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { add, checkout, commit, currentBranch, init, log } from 'isomorphic-git';
import { gitignorePath } from './paths.js';

const WORKSPACE_GITIGNORE = `package.*
.deckuse/write.lock
.deckuse/monitor/
.deckuse/preview/
.deckuse/preview.next/
.deckuse/render/
.deckuse/*.tmp
`;

const DEFAULT_BRANCH = 'main';

const GIT_AUTHOR = {
  name: 'deckuse',
  email: 'deckuse@local',
};

const repoDir = (workspace: string): string => resolve(workspace);

const repoOpts = (workspace: string) => ({
  fs,
  dir: repoDir(workspace),
});

export const hasWorkspaceGitRepo = async (workspace: string): Promise<boolean> => {
  try {
    await access(join(repoDir(workspace), '.git'));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};

export const ensureGitignore = async (workspace: string): Promise<void> => {
  await writeFile(gitignorePath(workspace), WORKSPACE_GITIGNORE);
};

export const initGitRepo = async (workspace: string, message: string): Promise<string> => {
  const opts = repoOpts(workspace);
  if (!(await hasWorkspaceGitRepo(workspace))) {
    await init({ ...opts, defaultBranch: DEFAULT_BRANCH });
  }
  await ensureGitignore(workspace);
  await add({ ...opts, filepath: '.' });
  return commit({ ...opts, message, author: GIT_AUTHOR });
};

export const commitWorkspace = async (workspace: string, message: string): Promise<string> => {
  const opts = repoOpts(workspace);
  await add({ ...opts, filepath: '.' });
  return commit({ ...opts, message, author: GIT_AUTHOR });
};

export const resetGit = async (workspace: string, steps: number): Promise<void> => {
  const dir = repoDir(workspace);
  const opts = repoOpts(workspace);
  const branch = await currentBranch(opts);
  if (!branch) throw new Error('Cannot reset workspace: detached HEAD');

  const commits = await log({ ...opts, depth: steps + 1 });
  if (commits.length < steps + 1) {
    throw new Error(
      `Cannot reset HEAD~${String(steps)}: only ${String(commits.length)} commit(s) available`,
    );
  }

  const target = commits[commits.length - 1]!;
  const gitdir = join(dir, '.git');
  await writeFile(join(gitdir, 'refs', 'heads', branch), `${target.oid}\n`);

  try {
    await unlink(join(gitdir, 'index'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await checkout({ ...opts, ref: branch, force: true });
};

export const operationCommitMessage = (operation: unknown): string => {
  if (typeof operation === 'object' && operation !== null) {
    const type = (operation as Record<string, unknown>)['type'];
    if (typeof type === 'string') return `deckuse: ${type}`;
  }
  return 'deckuse: write';
};
