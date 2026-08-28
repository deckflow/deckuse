import { access, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { gitignorePath } from './paths.js';

const WORKSPACE_GITIGNORE = `package.*
.deckuse/write.lock
.deckuse/*.tmp
`;

const git = (workspace: string): SimpleGit => simpleGit(resolve(workspace));

export const hasWorkspaceGitRepo = async (workspace: string): Promise<boolean> => {
  try {
    await access(join(resolve(workspace), '.git'));
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
  const repo = git(workspace);
  if (!(await hasWorkspaceGitRepo(workspace))) await repo.init();
  await ensureGitignore(workspace);
  await repo.add('.');
  const commit = await repo.commit(message);
  return commit.commit;
};

export const commitWorkspace = async (workspace: string, message: string): Promise<string> => {
  const repo = git(workspace);
  await repo.add('.');
  const commit = await repo.commit(message);
  return commit.commit;
};

export const resetGit = async (workspace: string, steps: number): Promise<void> => {
  await git(workspace).reset(['--hard', `HEAD~${String(steps)}`]);
};

export const operationCommitMessage = (operation: unknown): string => {
  if (typeof operation === 'object' && operation !== null) {
    const type = (operation as Record<string, unknown>)['type'];
    if (typeof type === 'string') return `deckuse: ${type}`;
  }
  return 'deckuse: write';
};
