import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderLibreOffice } from '../../src/render-libreoffice.js';
describe('optional LibreOffice renderer', () => {
  it('fails honestly when the backend is missing and leaves the output unchanged', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'deckuse-lo-test-'));
    await mkdir(join(workspace, '.deckuse'));
    await writeFile(
      join(workspace, '.deckuse/manifest.json'),
      JSON.stringify({ format: 'docx', revision: '1' }),
    );
    await writeFile(join(workspace, 'package.docx'), 'snapshot');
    const output = join(workspace, 'out.png');
    await writeFile(output, 'original');
    const previous = process.env['DECKUSE_SOFFICE_PATH'];
    process.env['DECKUSE_SOFFICE_PATH'] = join(workspace, 'missing-soffice');
    try {
      await expect(renderLibreOffice(workspace, 1, output)).rejects.toThrow();
      expect(await readFile(output, 'utf8')).toBe('original');
    } finally {
      if (previous === undefined) delete process.env['DECKUSE_SOFFICE_PATH'];
      else process.env['DECKUSE_SOFFICE_PATH'] = previous;
    }
  });
});
