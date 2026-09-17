import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '../src/render.js';

const workspaceFixture = async (): Promise<string> => {
  const workspace = await mkdtemp(join(tmpdir(), 'deckuse-render-'));
  await mkdir(join(workspace, '.deckuse'));
  await writeFile(join(workspace, 'package.pptx'), 'pptx');
  await writeFile(join(workspace, '.gitignore'), 'package.*\n');
  return workspace;
};

describe('renderPage', () => {
  it('requires a positive integer page', async () => {
    const workspace = await workspaceFixture();
    await expect(renderPage(workspace, { page: 0 })).rejects.toThrow(/positive integer/);
    await expect(renderPage(workspace, { page: 1.5 })).rejects.toThrow(/positive integer/);
  });

  it('converts one page, screenshots, and deletes office2html staging', async () => {
    const workspace = await workspaceFixture();
    const screenshots: Array<{ indexHtmlPath: string; outputPath: string }> = [];
    let stagingDuringConvert: string | undefined;

    const convert = vi.fn(async (_input: string, options: { output: string; pages?: string }) => {
      stagingDuringConvert = options.output;
      await writeFile(join(options.output, 'index.html'), '<html><div id="deck"></div></html>');
      return {
        indexHtmlPath: join(options.output, 'index.html'),
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
    });

    const screenshot = vi.fn(
      async (opts: { indexHtmlPath: string; outputPath: string }): Promise<void> => {
        screenshots.push(opts);
        await access(opts.indexHtmlPath);
        await mkdir(dirname(opts.outputPath), { recursive: true });
        await writeFile(opts.outputPath, 'png');
      },
    );

    const result = await renderPage(workspace, {
      page: 2,
      dependencies: { convert, screenshot },
    });

    expect(convert).toHaveBeenCalledWith(
      join(workspace, 'package.pptx'),
      expect.objectContaining({ pages: '2' }),
    );
    expect(result.page).toBe(2);
    expect(result.output).toBe(join(workspace, '.deckuse', 'render', 'page-2.png'));
    await expect(readFile(result.output, 'utf8')).resolves.toBe('png');
    expect(screenshots).toHaveLength(1);
    expect(stagingDuringConvert).toBeDefined();
    await expect(access(stagingDuringConvert!)).rejects.toMatchObject({ code: 'ENOENT' });

    const ignore = await readFile(join(workspace, '.gitignore'), 'utf8');
    expect(ignore).toContain('.deckuse/render/');
  });

  it('honors --output and surfaces conversion failures', async () => {
    const workspace = await workspaceFixture();
    const output = join(workspace, 'out', 'slide.png');
    const screenshot = vi.fn(async (opts: { outputPath: string }) => {
      await mkdir(dirname(opts.outputPath), { recursive: true });
      await writeFile(opts.outputPath, 'png');
    });

    await expect(
      renderPage(workspace, {
        page: 1,
        output,
        dependencies: {
          convert: async () => ({
            indexHtmlPath: join(workspace, 'missing.html'),
            exitCode: 2,
            stdout: '',
            stderr: 'boom',
          }),
          screenshot,
        },
      }),
    ).rejects.toThrow('boom');
    expect(screenshot).not.toHaveBeenCalled();

    const convert = vi.fn(async (_input: string, options: { output: string }) => {
      await writeFile(join(options.output, 'index.html'), '<html></html>');
      return {
        indexHtmlPath: join(options.output, 'index.html'),
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
    });
    const rendered = await renderPage(workspace, {
      page: 1,
      output,
      dependencies: { convert, screenshot },
    });
    expect(rendered.output).toBe(output);
  });
});
