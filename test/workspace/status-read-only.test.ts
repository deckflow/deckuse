import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readOnlyStatus } from '../../src/workspace/status-read-only.js';

it('observes incomplete or locked workspaces without reclaiming or recovering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-read-only-'));
  const state = join(root, '.deckuse');
  await mkdir(state);
  const manifest = join(state, 'manifest.json');
  const lock = join(state, 'write.lock');
  const marker = join(root, '.deckuse-init.lock');
  const rawLock = JSON.stringify({ pid: process.pid, acquiredAt: Date.now(), token: 'current' });
  await writeFile(manifest, '{"revision":"2"}');
  expect(await readOnlyStatus(root, 'missing')).toMatchObject({
    consistency: 'stable-observation',
    lock: { state: 'absent' },
    receipt: { state: 'missing' },
  });
  expect(await readdir(state)).toEqual(['manifest.json']);
  await writeFile(lock, rawLock);
  await writeFile(marker, '');
  await mkdir(join(state, 'transaction'));
  expect(await readOnlyStatus(root, 'missing')).toMatchObject({
    consistency: 'unknown',
    revision: '2',
    transactionPresent: true,
    initializationState: 'initialization-incomplete',
    lock: { state: 'alive', pid: process.pid },
    receipt: { state: 'unknown' },
  });
  expect(await readFile(lock, 'utf8')).toBe(rawLock);
  expect(await readFile(marker, 'utf8')).toBe('');
  expect(await readdir(state)).toEqual(['manifest.json', 'transaction', 'write.lock']);
});
