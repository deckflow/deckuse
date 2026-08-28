import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ensureGitignore, hasWorkspaceGitRepo, initGitRepo } from '../src/index.js';

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
    await initGitRepo(workspace, 'deckuse: init');
    expect(await hasWorkspaceGitRepo(workspace)).toBe(true);
    await expect(access(join(workspace, '.git'))).resolves.toBeUndefined();
  });
});
