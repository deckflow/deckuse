import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  commitWorkspace,
  ensureGitignore,
  hasWorkspaceGitRepo,
  initGitRepo,
  resetGit,
} from '../src/index.js';

const execFileAsync = promisify(execFile);

describe('deckuse workspace', () => {
  it('initializes git in workspace even when inside an ignored parent repo', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-nested-'));
    await writeFile(join(root, '.gitignore'), '__temps__\n');
    await execFileAsync('git', ['init'], { cwd: root });
    const workspace = join(root, '__temps__', 'test');
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'example.txt'), 'hello\n');
    expect(await hasWorkspaceGitRepo(workspace)).toBe(false);
    await ensureGitignore(workspace);
    await expect(readFile(join(workspace, '.gitignore'), 'utf8')).resolves.toContain(
      '.deckuse/monitor/',
    );
    await initGitRepo(workspace, 'deckuse: init');
    expect(await hasWorkspaceGitRepo(workspace)).toBe(true);
    await expect(access(join(workspace, '.git'))).resolves.toBeUndefined();
  });

  it('commits and hard-resets workspace history', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'deckuse-git-'));
    await writeFile(join(workspace, 'example.txt'), 'v1\n');
    await initGitRepo(workspace, 'deckuse: init');
    await writeFile(join(workspace, 'example.txt'), 'v2\n');
    const second = await commitWorkspace(workspace, 'deckuse: write');
    await writeFile(join(workspace, 'example.txt'), 'v3\n');
    await commitWorkspace(workspace, 'deckuse: write');

    await resetGit(workspace, 1);

    await expect(readFile(join(workspace, 'example.txt'), 'utf8')).resolves.toBe('v2\n');
    expect(second).toMatch(/^[0-9a-f]{40}$/);
  });
});
