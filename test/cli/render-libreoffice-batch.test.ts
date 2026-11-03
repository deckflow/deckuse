import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi } from 'vitest';
const calls = vi.hoisted(() => ({ convert: 0, pages: [] as string[] }));
vi.mock('../../src/office-backend.js', () => ({
  convertOfficeToPdf: async () => {
    calls.convert++;
    return { version: 'test-office' };
  },
  runOfficeProcess: async (file: string, args: string[]) => {
    if (file === 'pdfinfo') return { stdout: 'Pages: 3\n', stderr: '' };
    calls.pages.push(args[1]);
    if (args[1] === '2') throw Error('page failure');
    await writeFile(args.at(-1) + '.png', 'png');
    return { stdout: '', stderr: '' };
  },
}));
import { renderLibreOfficePages } from '../../src/render-libreoffice.js';
describe('LibreOffice batch', () => {
  it('converts once and retains successes around a failed page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-lo-batch-'));
    await mkdir(join(root, '.deckuse'));
    await writeFile(
      join(root, '.deckuse/manifest.json'),
      JSON.stringify({ format: 'docx', revision: '1' }),
    );
    await writeFile(join(root, 'package.docx'), 'snapshot');
    const result = await renderLibreOfficePages(root, undefined, join(root, 'out'));
    expect(calls.convert).toBe(1);
    expect(calls.pages).toEqual(['1', '2', '3']);
    expect(result.map((r) => r.ok)).toEqual([true, false, true]);
  });
});
