import { measurePreviewLayout } from './preview-layout.js';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser } from 'playwright-core';
import { RenderFailure } from './render-browser.js';

const require = createRequire(import.meta.url);
const slidesSelector = '#deck > .slide[data-surface="slide"]';

async function localize(entry: string) {
  let html = await readFile(entry, 'utf8');
  const tailwindScript = /<script\s+src="https:\/\/cdn\.tailwindcss\.com\/?"><\/script>/g;
  if (tailwindScript.test(html)) {
    const tailwindPath = require.resolve('tailwindcss');
    const postcss = createRequire(tailwindPath)('postcss') as (plugins: unknown[]) => {
      process(css: string, options: { from: undefined }): PromiseLike<{ css: string }>;
    };
    const tailwind = require(tailwindPath) as (config: {
      content: { raw: string; extension: string }[];
    }) => unknown;
    const css = await postcss([tailwind({ content: [{ raw: html, extension: 'html' }] })]).process(
      '@tailwind base; @tailwind components; @tailwind utilities;',
      { from: undefined },
    );
    await writeFile(join(dirname(entry), 'deckuse-tailwind.css'), css.css);
    html = html.replace(tailwindScript, '<link rel="stylesheet" href="deckuse-tailwind.css">');
  }
  html = html
    .replace(
      'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
      pathToFileURL(require.resolve('@fortawesome/fontawesome-free/css/all.min.css')).href,
    )
    .replace(
      'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js',
      pathToFileURL(require.resolve('echarts/dist/echarts.min.js')).href,
    );
  await writeFile(entry, html);
}

export async function openPptxRenderSession(
  browser: Browser,
  entry: string,
  count: number,
  scale = 1,
) {
  await localize(entry);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: scale,
  });
  try {
    const blocked = new Set<string>();
    const runtimeErrors: string[] = [];
    await context.route(/^https?:\/\//, async (route) => {
      blocked.add(route.request().url());
      await route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('requestfailed', (request) => {
      if (request.url().startsWith('file:')) blocked.add(request.url());
    });
    await page.goto(pathToFileURL(entry).href, { waitUntil: 'load', timeout: 30_000 });
    const deck = page.locator('#deck');
    await deck.waitFor({ state: 'attached', timeout: 10_000 });
    const slides = page.locator(slidesSelector);
    if ((await slides.count()) !== count)
      throw new Error('Converter output does not match the requested slide count');
    const dimensions = await deck.evaluate((element) => ({
      width: (element as HTMLElement).offsetWidth,
      height: (element as HTMLElement).offsetHeight,
    }));
    if (!dimensions.width || !dimensions.height) throw new Error('Invalid deck dimensions');
    await page.setViewportSize(dimensions);
    await page.addStyleTag({
      content: `
      #deck { transform: none !important; }
      #deck > .slide { position:absolute; inset:0; display:none !important; }
      #deck > .slide.is-active { display:block !important; }
      *, *::before, *::after { animation: none !important; transition: none !important; }
    `,
    });
    return {
      async screenshot(index: number, outputPath: string) {
        const slide = slides.nth(index);
        try {
          await slide.evaluate((element) => {
            for (const sibling of Array.from(element.parentElement?.children ?? []))
              sibling.classList.toggle('is-active', sibling === element);
            window.dispatchEvent(new Event('resize'));
          });
          await page.waitForFunction(
            (selector) => {
              const active = document.querySelector(selector);
              return Boolean(
                active &&
                document.fonts.status === 'loaded' &&
                Array.from(active.querySelectorAll('img')).every((img) => img.complete) &&
                Array.from(active.querySelectorAll('[data-echarts]')).every(
                  (chart) =>
                    chart.getAttribute('data-echarts-ready') === '1' ||
                    chart.getAttribute('data-echarts-state') === 'error',
                ),
              );
            },
            slidesSelector + '.is-active',
            { timeout: 15_000 },
          );
          const broken = await slide
            .locator('img')
            .evaluateAll(
              (images) => images.filter((img) => !(img as HTMLImageElement).naturalWidth).length,
            );
          if (blocked.size || broken)
            throw new RenderFailure(
              'RENDER_PAGE_LOAD_FAILED',
              'Slide resources could not be loaded locally',
              {
                stage: 'resources',
                blocked: [...blocked],
                brokenImages: broken,
              },
            );
          if (runtimeErrors.length || (await slide.locator('[data-echarts-state="error"]').count()))
            throw new RenderFailure('RENDER_CHART_FAILED', 'Chart or page runtime failed', {
              runtimeErrors,
            });
          // Resize handlers schedule font fitting and chart sizing before the next paint.
          await page.evaluate(
            () =>
              new Promise<void>((done) => {
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    done();
                  });
                });
              }),
          );
          await deck.screenshot({ path: outputPath, type: 'png', timeout: 15_000 });
          return {
            browserText: await slide.innerText(),
            layout: await slide.locator('.shape-text p').evaluateAll(measurePreviewLayout),
            chartWarnings: await slide.locator('[data-chart-warning]').evaluateAll((elements) =>
              elements.map((el) => ({
                id: el.getAttribute('data-chart-id') ?? el.id,
                message: el.getAttribute('data-chart-warning') ?? '',
              })),
            ),
          };
        } catch (cause) {
          if (cause instanceof RenderFailure) throw cause;
          throw new RenderFailure('RENDER_SCREENSHOT_FAILED', String(cause), {
            stage: 'page-readiness',
          });
        }
      },
      close: () => context.close(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function renderContactSheet(
  browser: Browser,
  paths: readonly string[],
  output: string,
) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  try {
    const images = await Promise.all(
      paths.map(
        async (path) =>
          `<img src="data:image/png;base64,${(await readFile(path)).toString('base64')}">`,
      ),
    );
    await page.setContent(`<style>body{margin:0;padding:12px;background:#e2e8f0;display:grid;
      grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}img{display:block;width:100%;}</style>${images.join('')}`);
    await page.locator('body').screenshot({ path: output, type: 'png' });
  } finally {
    await page.close();
  }
}
