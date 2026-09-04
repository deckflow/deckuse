import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import office2html from '@deckflow/office2html';
import { chromium, type Browser, type Page } from 'playwright-core';
import { ensureGitignore, renderDir } from '@deckflow/deckuse-workspace';

const PACKAGE_PPTX = 'package.pptx';
const DEFAULT_VIEWPORT = { width: 1280, height: 720 } as const;
const AUTOFIT_SETTLE_MS = 400;

export type ConvertFn = typeof office2html.convert;

export type ScreenshotFn = (options: {
  readonly indexHtmlPath: string;
  readonly outputPath: string;
}) => Promise<void>;

export interface RenderDependencies {
  readonly convert?: ConvertFn;
  readonly screenshot?: ScreenshotFn;
}

export interface RenderOptions {
  /** 1-based page index; exactly one page per call. */
  readonly page: number;
  /** PNG path; default: `<workspace>/.deckuse/render/page-<n>.png`. */
  readonly output?: string;
  readonly dependencies?: RenderDependencies;
}

export interface RenderResult {
  readonly page: number;
  readonly output: string;
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((done) => setTimeout(done, milliseconds));

const parseDeckSize = async (
  page: Page,
): Promise<{ width: number; height: number } | undefined> => {
  return page.evaluate(() => {
    const deck = document.getElementById('deck');
    if (!deck) return undefined;
    const style = getComputedStyle(deck);
    const width = Number.parseFloat(style.width);
    const height = Number.parseFloat(style.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
      return undefined;
    return { width: Math.round(width), height: Math.round(height) };
  });
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
      errors.push(
        `${channel}: ${error instanceof Error ? error.message : String(error)}`,
      );
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

const defaultScreenshot: ScreenshotFn = async ({ indexHtmlPath, outputPath }) => {
  const browser = await launchChromium();
  try {
    const context = await browser.newContext({
      viewport: DEFAULT_VIEWPORT,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const url = pathToFileURL(indexHtmlPath).href;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForSelector('#deck', { timeout: 30_000 });

    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });
    await sleep(AUTOFIT_SETTLE_MS);

    const size = await parseDeckSize(page);
    if (size) {
      await page.setViewportSize(size);
      await sleep(100);
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await page.locator('#deck').screenshot({ path: outputPath, type: 'png' });
    await context.close();
  } finally {
    await browser.close();
  }
};

/** Convert one workspace slide to PNG via office2html + playwright-core. */
export const renderPage = async (
  workspace: string,
  options: RenderOptions,
): Promise<RenderResult> => {
  const page = options.page;
  if (!Number.isInteger(page) || page < 1) {
    throw new Error('--page must be a positive integer (one page per render call)');
  }

  const absoluteWorkspace = resolve(workspace);
  await ensureGitignore(absoluteWorkspace);

  const output = resolve(
    options.output ?? joinRenderDefault(absoluteWorkspace, page),
  );
  const packagePath = resolve(absoluteWorkspace, PACKAGE_PPTX);
  const converter = options.dependencies?.convert ?? office2html.convert;
  const screenshot = options.dependencies?.screenshot ?? defaultScreenshot;

  const staging = await mkdtemp(join(tmpdir(), 'deckuse-render-'));
  try {
    const result = await converter(packagePath, {
      output: staging,
      pages: String(page),
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'office2html conversion failed');
    }

    const indexHtmlPath = resolve(result.indexHtmlPath);
    const entryRelative = relative(staging, indexHtmlPath);
    if (
      entryRelative.startsWith(`..${sep}`) ||
      entryRelative === '..' ||
      resolve(staging, entryRelative) !== indexHtmlPath
    ) {
      throw new Error('office2html returned an output outside the staging directory');
    }

    await mkdir(dirname(output), { recursive: true });
    await screenshot({ indexHtmlPath, outputPath: output });
    return { page, output };
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
};

const joinRenderDefault = (workspace: string, page: number): string =>
  resolve(renderDir(workspace), `page-${String(page)}.png`);
