import { mkdtemp, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCommand } from '../../src/index.js';
import { withWorkspaceTransaction, recoverTransaction } from '../../src/workspace/transaction.js';

describe('persistent transaction recovery', () => {
  it.each(['pptx', 'docx'])(
    'restores dirty working files and metadata when Git fails (%s)',
    async (format) => {
      const root = await mkdtemp(join(tmpdir(), 'deckuse-transaction-test-'));
      const base = { version: '2.0', workspaceId: root };
      expect(
        (
          await runCommand({
            ...base,
            type: 'init',
            format,
            source: resolve(`assets/default.${format}`),
          })
        ).ok,
      ).toBe(true);
      const part = format === 'pptx' ? 'ppt/slides/slide1.xml' : 'word/document.xml';
      const source = join(root, 'source', part);
      const dirty = (await readFile(source, 'utf8')).replace(/>\s*</, '> <!-- user edit --> <');
      await writeFile(source, dirty);
      const manifest = await readFile(join(root, '.deckuse/manifest.json'));
      const packed = await readFile(join(root, `package.${format}`));
      await rename(join(root, '.git/index'), join(root, '.git/index.saved'));
      await mkdir(join(root, '.git/index'));
      const result = await runCommand({
        ...base,
        transactionId: '1',
        ...(format === 'pptx'
          ? { type: 'addSlide', layout: 'Blank' }
          : { type: 'addParagraph', text: 'New paragraph' }),
      });
      expect(result.ok).toBe(false);
      expect(await readFile(source, 'utf8')).toBe(dirty);
      expect(await readFile(join(root, '.deckuse/manifest.json'))).toEqual(manifest);
      expect(await readFile(join(root, `package.${format}`))).toEqual(packed);
      expect(await readFile(join(root, '.deckuse/operations.jsonl'), 'utf8')).toBe('');
    },
  );
  it('preserves evidence for a malformed interrupted transaction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-transaction-test-'));
    await mkdir(join(root, '.deckuse/transaction'), { recursive: true });
    await writeFile(join(root, '.deckuse/transaction/journal.json'), 'broken');
    await expect(recoverTransaction(root)).rejects.toThrow('recovery required');
    expect(await readFile(join(root, '.deckuse/transaction/journal.json'), 'utf8')).toBe('broken');
  });
  it('restores actual files after an ordinary failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-transaction-test-'));
    await mkdir(join(root, 'source'), { recursive: true });
    await writeFile(join(root, 'source/user.xml'), 'original');
    await expect(
      withWorkspaceTransaction(root, async () => {
        await writeFile(join(root, 'source/user.xml'), 'changed');
        throw new Error('injected');
      }),
    ).rejects.toThrow('injected');
    expect(await readFile(join(root, 'source/user.xml'), 'utf8')).toBe('original');
  });
});

describe('invalid recovery evidence', () => {
  it('returns a structured recovery error before reading a partial workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-invalid-recovery-'));
    await mkdir(join(root, '.deckuse/transaction'), { recursive: true });
    await writeFile(join(root, '.deckuse/transaction/journal.json'), 'broken');
    const result = await runCommand({ version: '2.0', type: 'status', workspaceId: root });
    expect(result).toMatchObject({ ok: false, error: { code: 'RECOVERY_REQUIRED' } });
  });
});
