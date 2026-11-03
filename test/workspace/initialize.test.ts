import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withInitialization, WorkspaceNotEmptyError } from '../../src/workspace/initialize.js';

describe('workspace initialization reservation', () => {
  it('preserves an existing destination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-init-test-'));
    await writeFile(join(root, 'keep'), 'user content');
    await expect(withInitialization(root, async () => undefined)).rejects.toBeInstanceOf(
      WorkspaceNotEmptyError,
    );
    expect(await readFile(join(root, 'keep'), 'utf8')).toBe('user content');
  });
  it('cleans its own failed initialization and permits retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-init-test-'));
    await expect(
      withInitialization(root, async (staging) => {
        await writeFile(join(staging, 'partial'), 'partial');
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(await readdir(root)).toEqual([]);
    await expect(withInitialization(root, async () => 'ok')).resolves.toBe('ok');
  });
  it('does not delete unrelated files created during initialization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-init-test-'));
    await expect(
      withInitialization(root, async (staging) => {
        await writeFile(join(staging, 'partial'), 'owned');
        await writeFile(join(root, 'user-file'), 'keep');
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(await readdir(root)).toEqual(['user-file']);
    expect(await readFile(join(root, 'user-file'), 'utf8')).toBe('keep');
  });
  it('allows only one concurrent initializer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-init-test-'));
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withInitialization(root, async (staging) => {
      entered();
      await gate;
      await writeFile(join(staging, 'result'), 'first');
    });
    await ready;
    await expect(withInitialization(root, async () => undefined)).rejects.toBeInstanceOf(
      WorkspaceNotEmptyError,
    );
    release();
    await first;
    expect(await readFile(join(root, 'result'), 'utf8')).toBe('first');
  });
});
