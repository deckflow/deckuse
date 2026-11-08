import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { renderPages, parsePageSelection } from '../../src/render.js';
import { runCommand } from '../../src/index.js';

describe('batch render snapshot', () => {
  it('parses bounded ranges and rejects invalid selections', () => {
    expect(parsePageSelection('3,1,2-3')).toEqual([1, 2, 3]);
    for (const raw of ['0', '3-1', '1-999999999', '1,', 'x'])
      expect(() => parsePageSelection(raw)).toThrow();
  });
  it('retains successful pages and reads one immutable snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-batch-render-'));
    const base = { version: '2.0', workspaceId: root };
    expect(
      (
        await runCommand({
          ...base,
          type: 'init',
          format: 'pptx',
          source: resolve('assets/default.pptx'),
        })
      ).ok,
    ).toBe(true);
    expect(
      (await runCommand({ ...base, type: 'addSlide', transactionId: '1', layout: 'Blank' })).ok,
    ).toBe(true);
    const inputs: Buffer[] = [];
    const requestedPages: (string | undefined)[] = [];
    const result = await renderPages(root, {
      all: true,
      dependencies: {
        convert: async (input, options) => {
          inputs.push(await readFile(input));
          requestedPages.push(options.pages);
          await writeFile(join(root, 'package.pptx'), 'concurrent replacement');
          await writeFile(join(options.output, 'index.html'), '<div id="deck"></div>');
          return {
            exitCode: 0,
            stderr: '',
            stdout: '',
            indexHtmlPath: join(options.output, 'index.html'),
          };
        },
        screenshot: async (opts) => {
          if (opts.slideIndex === 1) throw new Error('injected screenshot failure');
          await writeFile(opts.outputPath, 'png');
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.results.map((r) => r.ok)).toEqual([true, false]);
    expect(inputs).toHaveLength(1);
    expect(requestedPages).toEqual(['1,2']);
    expect(result.results[0].result?.inputSha256).toBe(result.inputSha256);
    expect(await readFile(join(root, '.deckuse/render/page-1.png'), 'utf8')).toBe('png');
  });
});
