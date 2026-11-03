import { createRequire } from 'node:module';
import { timed } from './timing.js';
import { createHash } from 'node:crypto';
import { withWriteLock } from './workspace/lock.js';
import { recoverTransaction } from './workspace/transaction.js';
import { renderLibreOfficePages } from './render-libreoffice.js';
import { auditVisuals } from './pptx/visual-audit.js';
import { renderLibreOffice } from './render-libreoffice.js';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import deck2html from '@deckflow/deck2html';
import { chromium, type Browser, type Page } from 'playwright-core';
import type { Diagnostic } from './core/index.js';
import { OpcArchive } from './opc/index.js';
import { ensureGitignore, renderDir, sourceDir } from './workspace/index.js';
import { ensureDeck2HtmlExecutable } from './deck2html-exec.js';

const PACKAGE_PPTX = 'package.pptx';
const DEFAULT_VIEWPORT = { width: 1280, height: 720 } as const;
const AUTOFIT_SETTLE_MS = 400;

export type ConvertFn = typeof deck2html.convert;

export type ScreenshotFn = (options: {
  readonly indexHtmlPath: string;
  readonly outputPath: string;
  readonly scale?: number | undefined;
}) => Promise<void>;

export interface RenderDependencies {
  readonly convert?: ConvertFn;
  readonly screenshot?: ScreenshotFn;
}

export interface RenderOptions {
  /** 1-based page index; exactly one page per call. */
  readonly engine?: 'html' | 'libreoffice';
  readonly page: number;
  /** PNG path; default: `<workspace>/.deckuse/render/page-<n>.png`. */
  readonly output?: string;
  /** Device scale factor for screenshot (default 1). */
  readonly scale?: number | undefined;
  readonly dependencies?: RenderDependencies;
}

export interface RenderResult {
  readonly engine?: string;
  readonly engineVersion?: string;
  readonly pages?: number;
  readonly revision?: string;
  readonly inputSha256?: string;
  readonly fontVerification?: string;
  readonly nativeVerification?: string;
  readonly page: number;
  readonly output: string;
  readonly warnings: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((done) => setTimeout(done, milliseconds));

/** String scripts so commercial obfuscation cannot leak `_0x…` into Playwright. */
const PARSE_DECK_SIZE_SCRIPT = `(() => {
  const deck = document.getElementById('deck');
  if (!deck) return undefined;
  const style = getComputedStyle(deck);
  const width = Number.parseFloat(style.width);
  const height = Number.parseFloat(style.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    return undefined;
  return { width: Math.round(width), height: Math.round(height) };
})()`;

const WAIT_FONTS_SCRIPT = `(async () => {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
})()`;

const parseDeckSize = async (
  page: Page,
): Promise<{ width: number; height: number } | undefined> => {
  return page.evaluate(PARSE_DECK_SIZE_SCRIPT);
};

const launchChromium = async (): Promise<Browser> => {
  const executablePath =
    process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] ??
    process.env['CHROME_PATH'] ??
    process.env['CHROMIUM_PATH'];
  if (executablePath) {
    return chromium.launch({ executablePath, headless: true });
  }

  const channels = ['chrome', 'chromium', 'msedge'] as const;
  const errors: string[] = [];
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (error) {
      errors.push(`${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    [
      'Unable to launch a Chromium browser for render.',
      'Install Google Chrome / Chromium / Microsoft Edge, or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.',
      ...errors.map((line) => `  - ${line}`),
    ].join('\n'),
  );
};

const screenshotWithBrowser = async (
  browser: Browser,
  { indexHtmlPath, outputPath, scale }: Parameters<ScreenshotFn>[0],
) => {
  const context = await browser.newContext({
    viewport: DEFAULT_VIEWPORT,
    deviceScaleFactor: scale && scale > 0 ? scale : 1,
  });
  try {
    const page = await context.newPage();
    const url = pathToFileURL(indexHtmlPath).href;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForSelector('#deck', { timeout: 30_000 });

    await page.evaluate(WAIT_FONTS_SCRIPT);
    await sleep(AUTOFIT_SETTLE_MS);

    const size = await parseDeckSize(page);
    if (size) {
      await page.setViewportSize(size);
      await sleep(100);
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await page.locator('#deck').screenshot({ path: outputPath, type: 'png' });
  } finally {
    await context.close();
  }
};
const defaultScreenshot: ScreenshotFn = async (options) => {
  const browser = await launchChromium();
  try {
    await screenshotWithBrowser(browser, options);
  } finally {
    await browser.close();
  }
};

/** Convert one workspace slide to PNG via deck2html + playwright-core. */
const renderPageSnapshot = async (
  workspace: string,
  options: RenderOptions,
): Promise<RenderResult> => {
  const page = options.page;
  if (!Number.isInteger(page) || page < 1) {
    throw new Error('--page must be a positive integer (one page per render call)');
  }

  const absoluteWorkspace = resolve(workspace);
  if (options.engine === 'libreoffice')
    return renderLibreOffice(
      absoluteWorkspace,
      page,
      options.output ?? joinRenderDefault(absoluteWorkspace, page),
    );
  await ensureGitignore(absoluteWorkspace);

  let snapshot = PACKAGE_PPTX;
  let renderedRevision: string | undefined;
  try {
    const manifest = JSON.parse(
      await readFile(join(absoluteWorkspace, '.deckuse', 'manifest.json'), 'utf8'),
    ) as { format?: string; revision?: string };
    renderedRevision = manifest.revision;
    if (manifest.format === 'docx') snapshot = 'package.docx';
  } catch {
    // Missing manifest keeps the PPTX snapshot path used by existing render callers.
  }
  if (snapshot === 'package.docx') {
    throw new Error(
      'DOCX page render is not available. @deckflow/deck2html converts PPTX only and does not paginate Word documents. Export the .docx and open it in Word to check layout.',
    );
  }

  const output = resolve(options.output ?? joinRenderDefault(absoluteWorkspace, page));
  const packagePath = resolve(absoluteWorkspace, PACKAGE_PPTX);
  const converter = options.dependencies?.convert ?? deck2html.convert;
  const screenshot = options.dependencies?.screenshot ?? defaultScreenshot;
  const diagnostics = await inspectChartRenderFidelity(absoluteWorkspace, page);
  const warnings = diagnostics.map((item) => `${item.code}: ${item.message}`);

  if (!options.dependencies?.convert) await ensureDeck2HtmlExecutable();

  const staging = await mkdtemp(join(tmpdir(), 'deckuse-render-'));
  try {
    const result = await timed('convert', () =>
      converter(packagePath, {
        output: staging,
        pages: String(page),
      }),
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'deck2html conversion failed');
    }

    const indexHtmlPath = resolve(result.indexHtmlPath);
    const entryRelative = relative(staging, indexHtmlPath);
    if (
      entryRelative.startsWith(`..${sep}`) ||
      entryRelative === '..' ||
      resolve(staging, entryRelative) !== indexHtmlPath
    ) {
      throw new Error('deck2html returned an output outside the staging directory');
    }

    await mkdir(dirname(output), { recursive: true });
    await timed('screenshot', () =>
      screenshot({
        indexHtmlPath,
        outputPath: output,
        ...(options.scale !== undefined ? { scale: options.scale } : {}),
      }),
    );
    return {
      page,
      output,
      warnings,
      diagnostics,
      engine: 'html',
      ...(renderedRevision ? { revision: renderedRevision } : {}),
      engineVersion: (
        JSON.parse(
          await readFile(
            join(
              dirname(createRequire(import.meta.url).resolve('@deckflow/deck2html')),
              'package.json',
            ),
            'utf8',
          ),
        ) as { version: string }
      ).version,
      inputSha256: createHash('sha256')
        .update(await readFile(packagePath))
        .digest('hex'),
      fontVerification: 'unknown',
      nativeVerification: 'unverified',
    };
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
};

/** Capture package and revision under the same lock before either renderer reads. */
export const renderPage = async (
  workspace: string,
  options: RenderOptions,
): Promise<RenderResult> => {
  if (!Number.isInteger(options.page) || options.page < 1)
    throw new Error('--page must be a positive integer (one page per render call)');
  const root = resolve(workspace);
  const staging = await mkdtemp(join(tmpdir(), 'deckuse-single-snapshot-'));
  try {
    await withWriteLock(root, async () => {
      await recoverTransaction(root);
      let manifest: { format?: string; revision?: string } = {};
      try {
        manifest = JSON.parse(
          await readFile(join(root, '.deckuse/manifest.json'), 'utf8'),
        ) as typeof manifest;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      }
      const format = manifest.format ?? 'pptx';
      if (format === 'docx' && options.engine !== 'libreoffice')
        throw new Error(
          'DOCX page render is not available with HTML. Use --engine libreoffice or open the document in Word.',
        );
      if (format !== 'pptx' && format !== 'docx') throw new Error('Unsupported render format');
      const bytes = await readFile(join(root, `package.${format}`));
      await mkdir(join(staging, '.deckuse'));
      await writeFile(
        join(staging, '.deckuse/manifest.json'),
        JSON.stringify({ ...manifest, format }),
      );
      await writeFile(join(staging, `package.${format}`), bytes);
      await ensureGitignore(root);
    });
    return await renderPageSnapshot(staging, {
      ...options,
      output: options.output ?? joinRenderDefault(root, options.page),
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
};

const inspectChartRenderFidelity = async (
  workspace: string,
  page: number,
): Promise<Diagnostic[]> => {
  try {
    const packed = resolve(workspace, PACKAGE_PPTX);
    try {
      const archive = await OpcArchive.openFile(packed);
      return auditVisuals(archive, page).diagnostics;
    } catch {
      const archive = await OpcArchive.openDirectory(sourceDir(workspace));
      return auditVisuals(archive, page).diagnostics;
    }
  } catch {
    return [];
  }
};

const joinRenderDefault = (workspace: string, page: number): string =>
  resolve(renderDir(workspace), `page-${String(page)}.png`);

export interface RenderPagesOptions {
  readonly engine?: 'html' | 'libreoffice';
  readonly pages?: readonly number[] | undefined;
  readonly all?: boolean;
  readonly outputDir?: string | undefined;
  readonly scale?: number | undefined;
  readonly dependencies?: RenderDependencies;
}
export interface RenderPageOutcome {
  readonly page: number;
  readonly ok: boolean;
  readonly result?: RenderResult;
  readonly error?: string;
}
export interface RenderPagesResult {
  readonly ok: boolean;
  readonly engine: string;
  readonly revision: string;
  readonly inputSha256: string;
  readonly results: readonly RenderPageOutcome[];
}
export function parsePageSelection(raw: string): number[] {
  const pages = new Set<number>();
  for (const token of raw.split(',')) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token.trim());
    if (!match) throw new Error('Invalid page selection; use 1,3-5');
    const first = Number(match[1]),
      last = Number(match[2] ?? match[1]);
    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(last) ||
      first < 1 ||
      last < first ||
      last - first > 10000
    )
      throw new Error('Invalid page range');
    for (let page = first; page <= last; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}
/** Every result belongs to one immutable package snapshot, even if writes continue. */
export async function renderPages(
  workspace: string,
  options: RenderPagesOptions,
): Promise<RenderPagesResult> {
  if (Boolean(options.all) === Boolean(options.pages?.length))
    throw new Error('Choose pages or all');
  if (options.scale !== undefined && (!Number.isFinite(options.scale) || options.scale <= 0))
    throw new Error('Invalid render scale');
  const root = resolve(workspace);
  const staging = await mkdtemp(join(tmpdir(), 'deckuse-render-batch-'));
  let browser: Browser | undefined;
  try {
    const snapshot = await withWriteLock(root, async () => {
      await recoverTransaction(root);
      const manifest = JSON.parse(await readFile(join(root, '.deckuse/manifest.json'), 'utf8')) as {
        format: string;
        revision: string;
      };
      if (!['pptx', 'docx'].includes(manifest.format)) throw new Error('Unsupported render format');
      const bytes = await readFile(join(root, `package.${manifest.format}`));
      return { manifest, bytes };
    });
    const { manifest, bytes } = snapshot;
    const sha = createHash('sha256').update(bytes).digest('hex');
    await mkdir(join(staging, '.deckuse'));
    await writeFile(join(staging, '.deckuse/manifest.json'), JSON.stringify(manifest));
    await writeFile(join(staging, `package.${manifest.format}`), bytes);
    const outputDir = resolve(options.outputDir ?? join(root, '.deckuse/render'));
    if (options.engine === 'libreoffice') {
      const results = await renderLibreOfficePages(
        staging,
        options.all ? undefined : options.pages,
        outputDir,
      );
      return {
        ok: results.every((r) => r.ok),
        engine: 'libreoffice',
        revision: manifest.revision,
        inputSha256: sha,
        results,
      };
    }
    if (manifest.format !== 'pptx')
      throw new Error('HTML rendering supports PPTX only; use --engine libreoffice for DOCX');
    const archive = await OpcArchive.openFile(join(staging, 'package.pptx'));
    const count = archive
      .readXml('/ppt/presentation.xml')
      .getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/presentationml/2006/main',
        'sldId',
      ).length;
    const pages = options.all
      ? Array.from({ length: count }, (_, i) => i + 1)
      : [...new Set(options.pages)];
    if (pages.some((p) => !Number.isInteger(p) || p < 1 || p > count))
      throw new Error('Requested page does not exist');
    if (!options.dependencies?.screenshot) browser = await launchChromium();
    const shared = browser;
    const results: RenderPageOutcome[] = [];
    for (const page of pages) {
      try {
        const result = await renderPageSnapshot(staging, {
          page,
          output: join(outputDir, `page-${String(page)}.png`),
          scale: options.scale,
          dependencies: {
            ...options.dependencies,
            screenshot:
              options.dependencies?.screenshot ??
              (async (opts) => {
                if (!shared) throw new Error('Browser unavailable');
                await screenshotWithBrowser(shared, opts);
              }),
          },
        });
        results.push({
          page,
          ok: true,
          result: { ...result, revision: manifest.revision, inputSha256: sha },
        });
      } catch (cause) {
        results.push({
          page,
          ok: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    return {
      ok: results.every((r) => r.ok),
      engine: 'html',
      revision: manifest.revision,
      inputSha256: sha,
      results,
    };
  } finally {
    await browser?.close();
    await rm(staging, { recursive: true, force: true });
  }
}
