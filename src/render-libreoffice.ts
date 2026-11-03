import { convertOfficeToPdf, runOfficeProcess as invoke } from './office-backend.js';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, writeFile, rm, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
/** Optional local backend. Requires LibreOffice and Poppler; never rewrites the source. */
export async function renderLibreOffice(workspace: string, page: number, output: string) {
  const staging = await mkdtemp(join(tmpdir(), 'deckuse-office-'));
  try {
    const manifest = JSON.parse(
      await readFile(join(workspace, '.deckuse/manifest.json'), 'utf8'),
    ) as { format: string; revision: string };
    const input = join(workspace, `package.${manifest.format}`);
    const bytes = await readFile(input);
    const local = join(staging, `input.${manifest.format}`);
    await writeFile(local, bytes);
    const backend = await convertOfficeToPdf(local, staging, join(staging, 'profile'));
    const pdf = join(staging, 'input.pdf');
    const info = (await invoke('pdfinfo', [pdf])).stdout;
    const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
    if (!Number.isInteger(pages) || page > pages) throw new Error('Requested page does not exist');
    await invoke('pdftoppm', [
      '-f',
      String(page),
      '-l',
      String(page),
      '-singlefile',
      '-png',
      '-r',
      '144',
      pdf,
      join(staging, 'page'),
    ]);
    const absoluteOutput = resolve(output);
    await mkdir(dirname(absoluteOutput), { recursive: true });
    const temporary = `${absoluteOutput}.${createHash('sha256').update(staging).digest('hex').slice(0, 12)}.tmp`;
    try {
      await copyFile(join(staging, 'page.png'), temporary);
      await rename(temporary, absoluteOutput);
    } finally {
      await rm(temporary, { force: true });
    }
    return {
      page,
      output: absoluteOutput,
      pages,
      engine: 'libreoffice',
      engineVersion: backend.version,
      revision: manifest.revision,
      inputSha256: createHash('sha256').update(bytes).digest('hex'),
      fontVerification: 'unknown',
      nativeVerification: 'unverified',
      warnings: [
        'LibreOffice layout depends on installed fonts; native Office verification is pending.',
      ],
      diagnostics: [],
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Convert once, then retain successful pages if a later page fails. */
export async function renderLibreOfficePages(
  workspace: string,
  requested: readonly number[] | undefined,
  outputDir: string,
) {
  const staging = await mkdtemp(join(tmpdir(), 'deckuse-office-batch-'));
  try {
    const manifest = JSON.parse(
      await readFile(join(workspace, '.deckuse/manifest.json'), 'utf8'),
    ) as { format: string; revision: string };
    const bytes = await readFile(join(workspace, `package.${manifest.format}`));
    const local = join(staging, `input.${manifest.format}`);
    await writeFile(local, bytes);
    const backend = await convertOfficeToPdf(local, staging, join(staging, 'profile'));
    const pdf = join(staging, 'input.pdf');
    const count = Number(/^Pages:\s+(\d+)/m.exec((await invoke('pdfinfo', [pdf])).stdout)?.[1]);
    if (!Number.isInteger(count) || count < 1) throw new Error('Cannot determine PDF page count');
    const pages = requested
      ? [...new Set(requested)]
      : Array.from({ length: count }, (_, i) => i + 1);
    await mkdir(outputDir, { recursive: true });
    const results: import('./render.js').RenderPageOutcome[] = [];
    for (const page of pages) {
      try {
        if (!Number.isInteger(page) || page < 1 || page > count)
          throw new Error('Requested page does not exist');
        const prefix = join(staging, `page-${String(page)}`);
        await invoke('pdftoppm', [
          '-f',
          String(page),
          '-l',
          String(page),
          '-singlefile',
          '-png',
          '-r',
          '144',
          pdf,
          prefix,
        ]);
        const output = resolve(outputDir, `page-${String(page)}.png`);
        const temporary = `${output}.${createHash('sha256').update(staging).digest('hex').slice(0, 12)}.tmp`;
        try {
          await copyFile(`${prefix}.png`, temporary);
          await rename(temporary, output);
        } finally {
          await rm(temporary, { force: true });
        }
        results.push({
          page,
          ok: true,
          result: {
            page,
            output,
            pages: count,
            engine: 'libreoffice',
            engineVersion: backend.version,
            revision: manifest.revision,
            inputSha256: createHash('sha256').update(bytes).digest('hex'),
            fontVerification: 'unknown',
            nativeVerification: 'unverified',
            warnings: [
              'LibreOffice output requires visual review; native Office verification is pending.',
            ],
            diagnostics: [],
          },
        });
      } catch (cause) {
        results.push({
          page,
          ok: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    return results;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
