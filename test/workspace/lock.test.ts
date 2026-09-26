import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  acquireWriteLock,
  isWriteLockHeld,
  lockPath,
  withWriteLock,
} from '../../src/workspace/index.js';

const workspaceFixture = async (): Promise<string> => {
  const workspace = await mkdtemp(join(tmpdir(), 'deckuse-lock-'));
  await mkdir(join(workspace, '.deckuse'), { recursive: true });
  return workspace;
};

describe('workspace write lock', () => {
  it('withWriteLock removes the lock file after success', async () => {
    const workspace = await workspaceFixture();
    await withWriteLock(workspace, async () => {
      expect(await isWriteLockHeld(workspace)).toBe(true);
      const raw = await readFile(lockPath(workspace), 'utf8');
      const payload = JSON.parse(raw) as { pid: number; acquiredAt: number };
      expect(payload.pid).toBe(process.pid);
      expect(Number.isFinite(payload.acquiredAt)).toBe(true);
    });
    await expect(access(lockPath(workspace))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await isWriteLockHeld(workspace)).toBe(false);
  });

  it('reclaims empty and invalid lock files immediately', async () => {
    const workspace = await workspaceFixture();
    await writeFile(lockPath(workspace), '');
    expect(await isWriteLockHeld(workspace)).toBe(false);
    await expect(access(lockPath(workspace))).rejects.toMatchObject({ code: 'ENOENT' });

    await writeFile(lockPath(workspace), 'not-json\n');
    const release = await acquireWriteLock(workspace);
    expect(await isWriteLockHeld(workspace)).toBe(true);
    await release();
  });

  it('reclaims locks held by a dead pid', async () => {
    const workspace = await workspaceFixture();
    await writeFile(
      lockPath(workspace),
      `${JSON.stringify({ pid: 2_147_483_647, acquiredAt: Date.now() })}\n`,
    );
    const release = await acquireWriteLock(workspace);
    const raw = await readFile(lockPath(workspace), 'utf8');
    expect(JSON.parse(raw).pid).toBe(process.pid);
    await release();
  });

  it('waits while a live pid holds the lock', async () => {
    const workspace = await workspaceFixture();
    await writeFile(
      lockPath(workspace),
      `${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() })}\n`,
    );
    expect(await isWriteLockHeld(workspace)).toBe(true);

    let acquired = false;
    const pending = acquireWriteLock(workspace).then((release) => {
      acquired = true;
      return release;
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(acquired).toBe(false);

    await writeFile(lockPath(workspace), '');
    const release = await pending;
    expect(acquired).toBe(true);
    await release();
  });
});
