import { fontRiskReport, renderFontInventory } from './render-fonts.js';
import { createRequire } from 'node:module';
import { timed } from './timing.js';
import { createHash } from 'node:crypto';
import { withWriteLock } from './workspace/lock.js';
import { recoverTransaction } from './workspace/transaction.js';
import { auditVisuals } from './pptx/visual-audit.js';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import deck2html from '@deckflow/deck2html';
import { type Browser, type Page } from 'playwright-core';
import { launchRenderBrowser, RenderFailure } from './render-browser.js';
import type { Diagnostic } from './core/index.js';
import { OpcArchive } from './opc/index.js';
import { ensureGitignore, renderDir, sourceDir } from './workspace/index.js';
import { convertWithConfiguredBinary, ensureDeck2HtmlExecutable } from './deck2html-exec.js';

const PACKAGE_PPTX = 'package.pptx';
const DEFAULT_VIEWPORT = { width: 1280, height: 720 } as const;
const AUTOFIT_SETTLE_MS = 400;

export type ConvertFn = typeof deck2html.convert;

export type ScreenshotFn = (options: {
  readonly indexHtmlPath: string;
  readonly outputPath: string;
  readonly scale?: number | undefined;
  /** DOCX page in the paginated HTML (1-based). */
  readonly documentPage?: number;
  // Optional metadata preserves existing screenshot callbacks returning no value.
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
}) => Promise<void | { browserText: string; chartWarnings?: { id: string; message: string }[] }>;

export interface RenderDependencies {
  readonly convert?: ConvertFn;
  readonly screenshot?: ScreenshotFn;
}

export interface RenderOptions {
  /** 1-based page index; exactly one page per call. */
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
  readonly fontReport?: ReturnType<typeof fontRiskReport>['report'];
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

const DOCUMENT_PAGE_SELECTOR = 'section.doc-section, section.footnotes, section.endnotes';
const prepareDocumentPage = async (page: Page): Promise<void> => {
  await page.waitForSelector('main.doc', { timeout: 30_000 });
  await page.evaluate(WAIT_FONTS_SCRIPT);
  await page.waitForFunction(
    "document.documentElement.hasAttribute('data-o2h-paginated')",
    undefined,
    {
      timeout: 60_000,
    },
  );
  await page.evaluate(`document.querySelectorAll('section.is-lazy-page').forEach(section => {
    section.classList.remove('is-lazy-page');
    section.style.contentVisibility = 'visible';
  })`);
  await sleep(AUTOFIT_SETTLE_MS);
};

const screenshotWithBrowser = async (
  browser: Browser,
  { indexHtmlPath, outputPath, scale, documentPage }: Parameters<ScreenshotFn>[0],
) => {
  const context = await browser.newContext({
    viewport: DEFAULT_VIEWPORT,
    deviceScaleFactor: scale && scale > 0 ? scale : 1,
  });
  let stage = 'page-load';
  try {
    const page = await context.newPage();
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    const url = pathToFileURL(indexHtmlPath).href;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    if (documentPage !== undefined) {
      await prepareDocumentPage(page);
      const pages = page.locator(DOCUMENT_PAGE_SELECTOR);
      if (documentPage > (await pages.count())) throw new Error('Requested page does not exist');
      await mkdir(dirname(outputPath), { recursive: true });
      stage = 'screenshot';
      await pages.nth(documentPage - 1).screenshot({ path: outputPath, type: 'png' });
      return { browserText: await page.locator('body').innerText() };
    }
    await page.waitForSelector('#deck', { timeout: 30_000 });

    await page.evaluate(WAIT_FONTS_SCRIPT);
    await sleep(AUTOFIT_SETTLE_MS);

    stage = 'chart-initialization';
    try {
      await page.waitForFunction(
        `() => [...document.querySelectorAll('#deck [data-echarts]')].every(el =>
        el.getAttribute('data-echarts-ready') === '1' || el.getAttribute('data-echarts-state') === 'error')`,
        undefined,
        { timeout: 15_000 },
      );
    } catch {
      const pending = await page
        .locator('#deck [data-echarts]:not([data-echarts-ready="1"])')
        .count();
      throw new RenderFailure('RENDER_CHART_FAILED', 'Chart initialization did not complete', {
        pending,
        runtimeErrors,
      });
    }
    const chartErrors = await page
      .locator('#deck [data-echarts-state="error"]')
      .evaluateAll((elements) =>
        elements.map((el) => ({
          id: el.getAttribute('data-chart-id') ?? el.id,
          message: el.getAttribute('data-echarts-error'),
        })),
      );
    if (chartErrors.length || runtimeErrors.length)
      throw new RenderFailure('RENDER_CHART_FAILED', 'Chart or page runtime failed', {
        chartErrors,
        runtimeErrors,
      });
    const size = await parseDeckSize(page);
    if (size) {
      await page.setViewportSize(size);
      await sleep(100);
    }

    await mkdir(dirname(outputPath), { recursive: true });
    stage = 'screenshot';
    await page.locator('#deck').screenshot({ path: outputPath, type: 'png' });
    const chartWarnings = await page.locator('#deck [data-chart-warning]').evaluateAll((elements) =>
      elements.map((el) => ({
        id: el.getAttribute('data-chart-id') ?? el.id,
        message: el.getAttribute('data-chart-warning') ?? '',
      })),
    );
    return { browserText: await page.locator('#deck').innerText(), chartWarnings };
  } catch (cause) {
    if (cause instanceof RenderFailure) throw cause;
    throw new RenderFailure(
      stage === 'screenshot' ? 'RENDER_SCREENSHOT_FAILED' : 'RENDER_PAGE_LOAD_FAILED',
      cause instanceof Error ? cause.message : String(cause),
      { stage },
    );
  } finally {
    await context.close();
  }
};
const defaultScreenshot: ScreenshotFn = async (options) => {
  const browser = await launchRenderBrowser();
  try {
    return await screenshotWithBrowser(browser, options);
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
  const output = resolve(options.output ?? joinRenderDefault(absoluteWorkspace, page));
  const packagePath = resolve(absoluteWorkspace, snapshot);
  const converter = options.dependencies?.convert ?? convertWithConfiguredBinary;
  const screenshot = options.dependencies?.screenshot ?? defaultScreenshot;
  const diagnostics =
    snapshot === PACKAGE_PPTX ? await inspectChartRenderFidelity(absoluteWorkspace, page) : [];
  const warnings = diagnostics.map((item) => `${item.code}: ${item.message}`);

  if (!options.dependencies?.convert) await ensureDeck2HtmlExecutable();

  const staging = await mkdtemp(join(tmpdir(), 'deckuse-render-'));
  try {
    const result = await timed('convert', () =>
      converter(packagePath, {
        output: staging,
        ...(snapshot === PACKAGE_PPTX ? { pages: String(page) } : {}),
      }),
    );
    if (result.exitCode !== 0) {
      throw new RenderFailure(
        'RENDER_CONVERSION_FAILED',
        result.stderr || 'deck2html conversion failed',
        { stage: 'convert' },
      );
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
    const screenshotResult = await timed('screenshot', () =>
      screenshot({
        indexHtmlPath,
        outputPath: output,
        ...(snapshot === 'package.docx' ? { documentPage: page } : {}),
        ...(options.scale !== undefined ? { scale: options.scale } : {}),
      }),
    );
    const htmlContract = await readFile(indexHtmlPath, 'utf8');
    if (htmlContract.includes('data-echarts-state=') && !htmlContract.includes('ppt-degraded')) {
      for (let i = diagnostics.length - 1; i >= 0; i--) {
        const code = diagnostics[i]?.code;
        if (code === 'CHART_SERIES_COLOR_UNVERIFIED' || code === 'COMBO_CHART_RENDER_LIMITED')
          diagnostics.splice(i, 1);
      }
      for (let i = warnings.length - 1; i >= 0; i--)
        if (
          warnings[i]?.startsWith('CHART_SERIES_COLOR_UNVERIFIED:') ||
          warnings[i]?.startsWith('COMBO_CHART_RENDER_LIMITED:')
        )
          warnings.splice(i, 1);
    }
    for (const warning of screenshotResult?.chartWarnings ?? []) {
      diagnostics.push({
        severity: 'warning',
        code: 'CHART_NUMBER_FORMAT_UNSUPPORTED',
        message: warning.message,
        details: { page, chart: warning.id },
      });
      warnings.push(`CHART_NUMBER_FORMAT_UNSUPPORTED: ${warning.message}`);
    }
    let fontReport: ReturnType<typeof fontRiskReport>['report'] | undefined;
    try {
      const inventory = await renderFontInventory(
        packagePath,
        snapshot === PACKAGE_PPTX ? 'pptx' : 'docx',
        page,
      );
      const fontResult = fontRiskReport(
        inventory,
        `${result.stdout}\n${result.stderr}`,
        page,
        screenshotResult?.browserText,
      );
      diagnostics.push(...fontResult.diagnostics);
      warnings.push(...fontResult.diagnostics.map((d) => `${d.code}: ${d.message}`));
      fontReport = fontResult.report;
    } catch {
      warnings.push('FONT_INVENTORY_UNAVAILABLE: Font and text completeness remain unknown.');
      diagnostics.push({
        severity: 'warning',
        code: 'FONT_INVENTORY_UNAVAILABLE',
        message:
          'Input font inventory could not be read; font and text completeness remain unknown.',
        details: { page },
      });
    }
    return {
      page,
      output,
      warnings,
      diagnostics,
      ...(fontReport ? { fontReport } : {}),
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

/** Capture package and revision under the same lock before the renderer reads. */
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
  readonly errorCode?: string;
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
    let count: number;
    if (manifest.format === 'docx') {
      // Word's page count is determined by deck2html's browser pagination.
      if (!options.all) {
        count = Number.MAX_SAFE_INTEGER;
      } else {
        const htmlDir = join(staging, 'document-html');
        await mkdir(htmlDir);
        if (!options.dependencies?.convert) await ensureDeck2HtmlExecutable();
        const converted = await (options.dependencies?.convert ?? convertWithConfiguredBinary)(
          join(staging, 'package.docx'),
          { output: htmlDir },
        );
        if (converted.exitCode !== 0)
          throw new Error(converted.stderr || 'deck2html conversion failed');
        const entry = resolve(converted.indexHtmlPath);
        const entryRelative = relative(htmlDir, entry);
        if (entryRelative === '..' || entryRelative.startsWith(`..${sep}`))
          throw new Error('deck2html returned an output outside the staging directory');
        browser = await launchRenderBrowser();
        const page = await browser.newPage({ viewport: DEFAULT_VIEWPORT });
        try {
          await page.goto(pathToFileURL(entry).href, { waitUntil: 'networkidle', timeout: 60_000 });
          await prepareDocumentPage(page);
          count = await page.locator(DOCUMENT_PAGE_SELECTOR).count();
        } finally {
          await page.close();
        }
        if (count === 0) throw new Error('No document pages found');
      }
    } else {
      const archive = await OpcArchive.openFile(join(staging, 'package.pptx'));
      count = archive
        .readXml('/ppt/presentation.xml')
        .getElementsByTagNameNS(
          'http://schemas.openxmlformats.org/presentationml/2006/main',
          'sldId',
        ).length;
    }
    const pages = options.all
      ? Array.from({ length: count }, (_, i) => i + 1)
      : [...new Set(options.pages)];
    if (pages.some((p) => !Number.isInteger(p) || p < 1 || p > count))
      throw new Error('Requested page does not exist');
    if (!options.dependencies?.screenshot && !browser) browser = await launchRenderBrowser();
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
                return await screenshotWithBrowser(shared, opts);
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
          errorCode: cause instanceof RenderFailure ? cause.code : 'RENDER_FAILED',
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
