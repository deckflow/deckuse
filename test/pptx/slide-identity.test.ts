import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { runCommand } from '../../src/index.js';

describe('slide names and final identities', () => {
  it('returns the inventory identity and survives export/import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-slide-identity-'));
    const base = { version: '2.0', workspaceId: join(root, 'ws') };
    await runCommand({
      ...base,
      type: 'init',
      format: 'pptx',
      source: resolve('assets/default.pptx'),
    });
    const added = await runCommand({
      ...base,
      type: 'addSlide',
      transactionId: '1',
      name: 'Named slide',
      layout: 'Blank',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const list = await runCommand({ ...base, type: 'list', resource: 'slides' });
    if (!list.ok) throw Error('list failed');
    const item = (list.value as any).items[1];
    expect(added.value).toMatchObject({
      index: 2,
      target: item.target,
      uid: item.uid,
      partUri: item.partUri,
      affectedSlides: [2],
    });
    const output = join(root, 'out.pptx');
    expect((await runCommand({ ...base, type: 'export', output })).ok).toBe(true);
    const reopened = { ...base, workspaceId: join(root, 'reopened') };
    await runCommand({ ...reopened, type: 'init', format: 'pptx', source: output });
    const again = await runCommand({ ...reopened, type: 'list', resource: 'slides' });
    expect(again.ok && (again.value as any).items[1].name).toBe('Named slide');
  });
  it('maps added pages to final indexes after another insertion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-slide-identity-'));
    const base = { version: '2.0', workspaceId: root };
    await runCommand({
      ...base,
      type: 'init',
      format: 'pptx',
      source: resolve('assets/default.pptx'),
    });
    const result = await runCommand({
      ...base,
      type: 'batch',
      transactionId: '1',
      commands: [
        { ...base, type: 'addSlide', transactionId: '1', name: 'First added', layout: 'Blank' },
        {
          ...base,
          type: 'addSlide',
          transactionId: '1',
          after: 1,
          name: 'Inserted',
          layout: 'Blank',
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      affectedSlides: [2, 3],
      results: [
        { index: 3, target: 'slide:3' },
        { index: 2, target: 'slide:2' },
      ],
    });
  });
});
