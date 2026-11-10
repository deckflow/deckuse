import type { PreviewFinding } from './preview-layout.js';
import { cNvPrIdOf, targetPathForItem } from './pptx/addressing.js';
import { requireDefined } from './required.js';
import { readRenderCache, renderEnvironmentKey, writeRenderCache } from './render-cache.js';
import { openPptxRenderSession, renderContactSheet } from './render-pptx-browser.js';
import { readOperations } from './workspace/operations.js';
import { buildIndex } from './pptx/indexer.js';
import type { IndexFile } from './pptx/types.js';
import { fontRiskReport, renderFontInventory } from './render-fonts.js';
import { createRequire } from 'node:module';
import { timed, timedSync } from './timing.js';
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
import {
  convertWithConfiguredBinary,
  ensureDeck2HtmlExecutable,
  converterFailure,
  converterPreflight,
} from './deck2html-exec.js';

const PACKAGE_PPTX = 'package.pptx';
const DEFAULT_VIEWPORT = { width: 1280, height: 720 } as const;
const AUTOFIT_SETTLE_MS = 400;

export type ConvertFn = typeof deck2html.convert;

export type ScreenshotFn = (options: {
  readonly indexHtmlPath: string;
  readonly outputPath: string;
  readonly scale?: number | undefined;
  readonly slideIndex?: number;
  /** DOCX page in the paginated HTML (1-based). */
  readonly documentPage?: number;
  // Optional metadata preserves existing screenshot callbacks returning no value.
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
}) => Promise<void | {
  browserText: string;
  chartWarnings?: { id: string; message: string }[];
  layout?: { findings: PreviewFinding[]; shapeIds: string[] };
}>;

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

async function cleanupRenderStaging(staging: string) {
  try {
    await timed('cleanup-render-staging', () => rm(staging, { recursive: true, force: true }));
  } catch (cause) {
    process.stderr.write(`deckuse: RENDER_CLEANUP_FAILED (${staging}): ${String(cause)}\n`);
  }
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
  batch?: {
    converted: Awaited<ReturnType<ConvertFn>>;
    directory: string;
    slideIndex: number;
    archive: OpcArchive;
    index: IndexFile;
    sha: string;
  },
): Promise<RenderResult> => {
  const page = options.page;
  if (!Number.isInteger(page) || page < 1) {
    throw new Error('--page must be a positive integer (one page per render call)');
  }

  const absoluteWorkspace = resolve(workspace);
  if (!batch) await ensureGitignore(absoluteWorkspace);

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
  const offlineSingle =
    snapshot === PACKAGE_PPTX &&
    !batch &&
    !options.dependencies?.screenshot &&
    !options.dependencies?.convert;
  const screenshot: ScreenshotFn =
    options.dependencies?.screenshot ??
    (offlineSingle
      ? async ({ indexHtmlPath, outputPath, scale }) => {
          const browser = await launchRenderBrowser();
          try {
            const session = await openPptxRenderSession(browser, indexHtmlPath, 1, scale);
            try {
              return await session.screenshot(0, outputPath);
            } finally {
              await session.close();
            }
          } finally {
            await browser.close();
          }
        }
      : defaultScreenshot);

  const diagnostics =
    snapshot === PACKAGE_PPTX
      ? batch
        ? auditVisuals(batch.archive, page, batch.index).diagnostics
        : await inspectChartRenderFidelity(absoluteWorkspace, page)
      : [];
  const warnings = diagnostics
    .filter((item) => item.severity !== 'info')
    .map((item) => `${item.code}: ${item.message}`);

  if (!batch && !options.dependencies?.convert) await ensureDeck2HtmlExecutable();

  const staging = batch?.directory ?? (await mkdtemp(join(tmpdir(), 'deckuse-render-')));
  try {
    const result =
      batch?.converted ??
      (await timed('convert', () =>
        converter(packagePath, {
          output: staging,
          ...(snapshot === PACKAGE_PPTX ? { pages: String(page) } : {}),
          ...(offlineSingle
            ? { noPlayer: true, noLazySlides: true, includeHiddenSlides: true }
            : {}),
        }),
      ));
    if (result.exitCode !== 0) {
      throw converterFailure(result.stderr || 'deck2html conversion failed');
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
        ...(batch ? { slideIndex: batch.slideIndex } : {}),
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
    if (screenshotResult?.layout) {
      const index =
        batch?.index ??
        buildIndex(await OpcArchive.openFile(packagePath), 'render', renderedRevision ?? '0');
      const slide = index.elements.filter((item) => item.kind === 'slide')[page - 1];
      const shapes = new Map(
        index.elements
          .filter((item) => item.partUri === slide?.partUri)
          .map((item) => [cNvPrIdOf(item), item]),
      );
      const measuredTargets = new Set(
        screenshotResult.layout.shapeIds.flatMap((id) => {
          const shape = shapes.get(id);
          return shape ? [targetPathForItem(index, shape)] : [];
        }),
      );
      for (let i = diagnostics.length - 1; i >= 0; i--) {
        const diagnostic = diagnostics[i];
        const { target, targets } = diagnostic?.details ?? {};
        if (
          (diagnostic?.code === 'TEXT_OVERFLOW_SUSPECTED' &&
            typeof target === 'string' &&
            measuredTargets.has(target)) ||
          (diagnostic?.code === 'CONTENT_OVERLAP_SUSPECTED' &&
            Array.isArray(targets) &&
            targets.every((item) => typeof item === 'string' && measuredTargets.has(item)))
        )
          diagnostics.splice(i, 1);
      }
      for (const finding of screenshotResult.layout.findings) {
        const shape = shapes.get(finding.shapeId);
        const other = shapes.get(finding.otherShapeId);
        const message =
          'Measured in the preview render. PowerPoint may wrap differently with other fonts. ' +
          finding.action;
        diagnostics.push({
          severity: 'warning',
          code: finding.code,
          message,
          details: {
            ...finding,
            page,
            measured: true,
            heuristic: false,
            target: shape
              ? targetPathForItem(index, shape)
              : `slide:${String(page)}/shape:${finding.shapeId}`,
            shapeName: shape?.name,
            ...(other
              ? { otherShapeName: other.name, otherTarget: targetPathForItem(index, other) }
              : {}),
          },
        });
        warnings.push(finding.code + ': ' + message);
      }
    }
    let fontReport: ReturnType<typeof fontRiskReport>['report'] | undefined;
    try {
      const inventory = await renderFontInventory(
        packagePath,
        snapshot === PACKAGE_PPTX ? 'pptx' : 'docx',
        page,
        batch?.archive,
        batch?.index,
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
      inputSha256:
        batch?.sha ??
        createHash('sha256')
          .update(await readFile(packagePath))
          .digest('hex'),
      fontVerification: 'unknown',
      nativeVerification: 'unverified',
    };
  } finally {
    if (!batch) await cleanupRenderStaging(staging);
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
    await cleanupRenderStaging(staging);
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
  readonly sinceRevision?: string | undefined;
  readonly contactSheet?: boolean;
  readonly reviewNotes?: readonly RenderReviewNote[];
  readonly outputDir?: string | undefined;
  readonly scale?: number | undefined;
  readonly dependencies?: RenderDependencies;
}
export interface RenderReviewNote {
  code: 'OBJECT_OUT_OF_BOUNDS' | 'CONTENT_OVERLAP_SUSPECTED';
  targets: string[];
  reason: string;
}

export function parseRenderReviewNotes(raw: string): RenderReviewNote[] {
  const notes = JSON.parse(raw) as unknown;
  if (!Array.isArray(notes)) throw new Error('Review notes must be a JSON array');
  return notes.map((note: Partial<RenderReviewNote> | null) => {
    if (
      !note ||
      !['OBJECT_OUT_OF_BOUNDS', 'CONTENT_OVERLAP_SUSPECTED'].includes(note.code ?? '') ||
      !Array.isArray(note.targets) ||
      !note.targets.every((target) => typeof target === 'string' && target) ||
      note.targets.length !== (note.code === 'OBJECT_OUT_OF_BOUNDS' ? 1 : 2) ||
      typeof note.reason !== 'string' ||
      !note.reason.trim()
    )
      throw new Error('Each review note needs an exact diagnostic code, target(s), and reason');
    return note as RenderReviewNote;
  });
}

function annotateReview(result: RenderPageOutcome, notes: readonly RenderReviewNote[]) {
  if (!result.result || !notes.length) return result;
  return {
    ...result,
    result: {
      ...result.result,
      diagnostics: result.result.diagnostics.map((diagnostic) => {
        const raw = diagnostic.details?.['targets'] ?? [diagnostic.details?.['target']];
        const targets = Array.isArray(raw) ? raw : [];
        const note = notes.find(
          (note) =>
            note.code === diagnostic.code &&
            targets.length === note.targets.length &&
            note.targets.every((target) => targets.includes(target)),
        );
        return note
          ? { ...diagnostic, details: { ...diagnostic.details, reviewReason: note.reason } }
          : diagnostic;
      }),
    },
  };
}

export interface RenderPageOutcome {
  readonly page: number;
  readonly ok: boolean;
  readonly result?: RenderResult;
  readonly error?: string;
  readonly errorCode?: string;
  readonly reusedFromRevision?: string;
  readonly errorDetails?: unknown;
}
export interface RenderPagesResult {
  readonly ok: boolean;
  readonly engine: string;
  readonly revision: string;
  readonly inputSha256: string;
  readonly results: readonly RenderPageOutcome[];
  readonly contactSheet?: string;
}
function renderPageError(page: number, cause: unknown): RenderPageOutcome {
  return {
    page,
    ok: false,
    error: cause instanceof Error ? cause.message : String(cause),
    ...(cause instanceof RenderFailure
      ? { errorCode: cause.code, errorDetails: cause.details }
      : { errorCode: 'RENDER_FAILED' }),
  };
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
  if ([options.all, options.pages?.length, options.sinceRevision].filter(Boolean).length !== 1)
    throw new Error('Choose pages or all');
  if (options.scale !== undefined && (!Number.isFinite(options.scale) || options.scale <= 0))
    throw new Error('Invalid render scale');
  const preflight = !options.dependencies?.convert ? await converterPreflight() : undefined;
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
      const history = options.sinceRevision ? await readOperations(root) : [];
      return { manifest, bytes, history };
    });
    const { manifest, bytes } = snapshot;
    const sha = createHash('sha256').update(bytes).digest('hex');
    await mkdir(join(staging, '.deckuse'));
    await writeFile(join(staging, '.deckuse/manifest.json'), JSON.stringify(manifest));
    await writeFile(join(staging, `package.${manifest.format}`), bytes);
    const outputDir = resolve(options.outputDir ?? join(root, '.deckuse/render'));
    let count: number;
    let archive: OpcArchive | undefined;
    if (options.sinceRevision && manifest.format !== 'pptx')
      throw new Error('--since-revision requires a PPTX workspace');
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
          throw converterFailure(converted.stderr || 'deck2html conversion failed');
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
      archive = await OpcArchive.openFile(join(staging, 'package.pptx'));
      count = archive
        .readXml('/ppt/presentation.xml')
        .getElementsByTagNameNS(
          'http://schemas.openxmlformats.org/presentationml/2006/main',
          'sldId',
        ).length;
    }
    const pages =
      options.all || options.sinceRevision
        ? Array.from({ length: count }, (_, i) => i + 1)
        : [...new Set(options.pages)];
    if (pages.some((p) => !Number.isInteger(p) || p < 1 || p > count))
      throw new Error('Requested page does not exist');
    if (archive) {
      const selected = [...pages].sort((a, b) => a - b);
      const available = new Map<number, RenderPageOutcome>();
      const index = buildIndex(archive, 'render', manifest.revision);
      const slideParts = index.elements
        .filter((item) => item.kind === 'slide')
        .map((item) => item.partUri);
      const shared = createHash('sha256');
      shared.update(
        JSON.stringify({
          converter: preflight?.version,
          scale: options.scale ?? 1,
          environment: options.dependencies
            ? 'injected'
            : await renderEnvironmentKey(preflight?.binary),
        }),
      );
      for (const [name, part] of [...archive.parts].sort(([a], [b]) => a.localeCompare(b))) {
        if (!/^\/ppt\/(slides|notesSlides)\//.test(name))
          shared.update(name).update(createHash('sha256').update(part.data).digest());
      }
      const keys = new Map(
        selected.map((page) => {
          const part = slideParts[page - 1] ?? '';
          const rel = part.replace(/\/([^/]+)$/, '/_rels/$1.rels');
          const key = shared.copy().update(part);
          for (const name of [part, rel]) {
            const bytes = archive.getPart(name)?.data;
            if (bytes) key.update(createHash('sha256').update(bytes).digest());
          }
          return [page, key.digest('hex')];
        }),
      );
      const base = options.sinceRevision;
      const baseIndex = snapshot.history.findIndex((record) => record.revision === base);
      const trustedBase =
        base &&
        (base === manifest.revision ||
          ((base === '1' || baseIndex >= 0) &&
            snapshot.history.slice(baseIndex + 1).every((record) => record.changedParts)));

      if (trustedBase && !options.dependencies) {
        for (const page of selected) {
          const output = join(outputDir, `page-${String(page)}.png`);
          const cached = await timed('render-cache-lookup', () =>
            readRenderCache(output, keys.get(page)),
          );
          timedSync(cached ? 'render-cache-hit' : 'render-cache-miss', () => undefined);
          if (cached)
            available.set(page, {
              page,
              ok: true,
              result: cached,
              reusedFromRevision: cached.revision ?? 'unknown',
            });
        }
      }
      const pending = selected.filter((page) => !available.has(page));
      if (pending.length) {
        try {
          const directory = join(staging, 'slides-html');
          await mkdir(directory);
          const converted = await timed('convert', () =>
            (options.dependencies?.convert ?? convertWithConfiguredBinary)(
              join(staging, PACKAGE_PPTX),
              {
                output: directory,
                pages: pending.join(','),
                noPlayer: true,
                noLazySlides: true,
                includeHiddenSlides: true,
              },
            ),
          );
          if (converted.exitCode !== 0)
            throw converterFailure(converted.stderr || 'deck2html conversion failed');
          const entry = resolve(converted.indexHtmlPath);
          const relativeEntry = relative(directory, entry);
          if (relativeEntry === '..' || relativeEntry.startsWith(`..${sep}`))
            throw new Error('deck2html returned an output outside the staging directory');
          if (!options.dependencies?.screenshot) browser = await launchRenderBrowser();
          const session = browser
            ? await openPptxRenderSession(browser, entry, pending.length, options.scale)
            : undefined;
          try {
            for (const [slideIndex, page] of pending.entries()) {
              const output = join(outputDir, `page-${String(page)}.png`);
              try {
                const result = await renderPageSnapshot(
                  staging,
                  {
                    page,
                    output,
                    scale: options.scale,
                    dependencies: {
                      ...options.dependencies,
                      screenshot:
                        options.dependencies?.screenshot ??
                        ((opts) => {
                          if (!session) throw new Error('Render session unavailable');
                          return session.screenshot(slideIndex, opts.outputPath);
                        }),
                    },
                  },
                  { converted, directory, slideIndex, archive, index, sha },
                );
                if (!options.dependencies)
                  await writeRenderCache(result, keys.get(page)).catch((error: unknown) => {
                    process.stderr.write(`deckuse: RENDER_CACHE_WRITE_FAILED: ${String(error)}\n`);
                  });
                available.set(page, { page, ok: true, result });
              } catch (cause) {
                available.set(page, renderPageError(page, cause));
              }
            }
          } finally {
            await session?.close();
          }
        } catch (cause) {
          if (!available.size) throw cause;
          for (const page of pending) {
            if (!available.has(page)) available.set(page, renderPageError(page, cause));
          }
        }
      }
      const results = pages.map((page) =>
        annotateReview(requireDefined(available.get(page)), options.reviewNotes ?? []),
      );
      const ok = results.every((result) => result.ok);
      const contactSheet =
        options.contactSheet && ok ? join(outputDir, 'contact-sheet.png') : undefined;
      if (contactSheet) {
        browser ??= await launchRenderBrowser();
        await renderContactSheet(
          browser,
          results.map((item) => requireDefined(item.result).output),
          contactSheet,
        );
      }
      return {
        ok,
        engine: 'html',
        revision: manifest.revision,
        inputSha256: sha,
        results,
        ...(contactSheet ? { contactSheet } : {}),
      };
    }
    if (options.contactSheet || options.reviewNotes)
      throw new Error('Contact sheets and review notes require PPTX');
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
        if (cause instanceof RenderFailure && cause.code === 'RENDER_CONVERTER_EXTRACTION_FAILED')
          throw cause;
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
    try {
      await browser?.close();
    } finally {
      await cleanupRenderStaging(staging);
    }
  }
}
