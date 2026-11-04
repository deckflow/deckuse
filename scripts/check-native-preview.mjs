#!/usr/bin/env node
/** Build first; DECKUSE_TEST_CONVERTER points to the companion trimmed native binary. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
const require = createRequire(import.meta.url),
  repo = fileURLToPath(new URL('..', import.meta.url));
const packageRoot = process.env.DECKUSE_TEST_PACKAGE_ROOT ?? repo;
const { createDefaultExecutor } = await import(
  pathToFileURL(join(packageRoot, 'dist/index.js')).href
);
const { renderPage, renderPages } = await import(
  pathToFileURL(join(packageRoot, 'dist/render.js')).href
);
const { convertWithConfiguredBinary } = await import(
  pathToFileURL(join(packageRoot, 'dist/deck2html-exec.js')).href
);
const { OpcArchive } = await import(pathToFileURL(join(packageRoot, 'dist/opc/index.js')).href);
const { first } = await import(pathToFileURL(join(packageRoot, 'dist/pptx/xml.js')).href);
const binary = process.env.DECKUSE_TEST_CONVERTER;
if (!binary)
  throw Error('Set DECKUSE_TEST_CONVERTER to a freshly published trimmed deck2html binary');
const root = await mkdtemp(join(tmpdir(), 'deckuse-preview-')),
  workspaceId = join(root, 'ws'),
  ex = createDefaultExecutor();
let revision = '1';
async function run(input) {
  const payload = {
    version: '2.0',
    workspaceId,
    ...(input.type === 'export' || input.type === 'init' ? {} : { transactionId: revision }),
    ...input,
  };
  const r = await ex.execute(payload);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (r.value?.revision) revision = String(r.value.revision);
  return r.value;
}
await run({ type: 'init', format: 'pptx', source: join(packageRoot, 'assets/default.pptx') });
const formats = ['General', '0', '0.0', '0%', '0"%"', '"USD "0.0'];
const cases = formats.map((format, i) => ({
  family: 'column',
  format,
  expected: ['0.25', '0', '0.3', '25%', '0%', 'USD 0.3'][i],
}));
for (const family of ['bar', 'line', 'combo'])
  cases.push({ family, format: '0.0', expected: '0.3' });
cases.push({ family: 'column', format: '[>=1]0;0', unsupported: true });
for (const [i, c] of cases.entries()) {
  await run({ type: 'addSlide' });
  await run({
    type: 'addShape',
    slide: i + 2,
    shapeType: 'chart',
    name: 'Chart',
    chartType: c.family,
    x: 100000,
    y: 100000,
    width: '7in',
    height: '4in',
    data: {
      categories: ['A', 'B'],
      series: [
        {
          name: 'Same',
          values: [0.25, 0.5],
          color: '888888',
          ...(c.family === 'combo' ? { chart: 'column' } : {}),
        },
        {
          name: 'Same',
          values: [0.75, 0.8],
          color: '990099',
          ...(c.family === 'combo' ? { chart: 'line', axis: 'secondary' } : {}),
        },
      ],
    },
  });
  await run({
    type: 'set',
    target: `slide:${i + 2}/shape:Chart`,
    properties: { valueFormatCode: c.format },
  });
}
const output = join(root, 'charts.pptx');
await run({ type: 'export', output });
// Include a theme fill case without relying on a public write API to create test input.
const archive = await OpcArchive.openFile(output);
const part = '/ppt/charts/chart1.xml',
  doc = archive.readXml(part),
  color = first(doc, 'srgbClr');
if (color) {
  const scheme = doc.createElementNS(color.namespaceURI, 'a:schemeClr');
  scheme.setAttribute('val', 'accent1');
  color.parentNode.replaceChild(scheme, color);
  archive.writeXml(part, doc);
}
await archive.writeFile(output, true);
const html = join(root, 'html');
execFileSync(binary, [output, '-o', html, '--no-lazy-slides'], { stdio: 'pipe' });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/echarts@*/**', (r) =>
    r.fulfill({
      path: require.resolve('echarts/dist/echarts.min.js'),
      contentType: 'application/javascript',
    }),
  );
  await page.goto(pathToFileURL(join(html, 'index.html')).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.__pptInitCharts(document));
  const results = await page.locator('[data-echarts]').evaluateAll((els) =>
    els.map((el) => {
      const chart = echarts.getInstanceByDom(el),
        o = chart?.getOption();
      const axes = [...(o?.xAxis ?? []), ...(o?.yAxis ?? [])],
        axis = axes.find((a) => a.type === 'value');
      return {
        state: el.getAttribute('data-echarts-state'),
        warning: el.getAttribute('data-chart-warning'),
        label:
          typeof axis?.axisLabel?.formatter === 'function'
            ? axis.axisLabel.formatter(0.25)
            : undefined,
        legend: o?.legend?.[0]?.data,
        colors: o?.series?.map((s) => s.itemStyle?.color),
        series: o?.series?.map((s) => ({ name: s.name, color: s.itemStyle?.color })),
        canvas: !!el.querySelector('canvas'),
      };
    }),
  );
  await writeFile(join(root, 'debug.json'), JSON.stringify({ cases, results, errors }, null, 2));
  console.log(root);
  assert.equal(results.length, cases.length);
  assert.deepEqual(errors, []);
  results.forEach((r, i) => {
    assert.equal(r.state, 'ready', JSON.stringify(r));
    assert.equal(r.canvas, true);
    if (cases[i].unsupported) assert.ok(r.warning);
    else assert.equal(r.label, cases[i].expected);
    assert.equal(r.legend.length, 2);
    assert.notEqual(r.legend[0].name, r.legend[1].name);
    for (const entry of r.legend) {
      const series = r.series.find((s) => s.name === entry.name);
      assert.ok(series);
      if (entry.icon?.startsWith('image://'))
        assert.ok(decodeURIComponent(entry.icon).includes(series.color));
      else assert.equal(entry.itemStyle.color, series.color);
    }
    if (i > 0) assert.deepEqual([...r.colors].sort(), ['#888888', '#990099']);
  });
  // Every chart must enter error when ECharts initialization throws.
  await page.evaluate(() => {
    document.querySelectorAll('[data-echarts]').forEach((el) => {
      const chart = echarts.getInstanceByDom(el);
      chart?.dispose();
      el.removeAttribute('data-echarts-ready');
    });
    echarts.init = () => {
      throw Error('Injected chart failure');
    };
    window.__pptInitCharts(document);
  });
  assert.equal(await page.locator('[data-echarts-state="error"]').count(), cases.length);
  // Missing CDN must remain observably unfinished, never ready.
  const offline = await browser.newPage();
  await offline.route('**/echarts@*/**', (r) => r.abort());
  await offline.goto(pathToFileURL(join(html, 'index.html')).href, { waitUntil: 'networkidle' });
  assert.equal(await offline.locator('[data-echarts-ready="1"]').count(), 0);
  await offline.close();
  await writeFile(join(root, 'report.json'), JSON.stringify({ cases, results, errors }, null, 2));
  console.log(
    `native preview regression: ${cases.length} cases + initialization/CDN failures passed; ${root}`,
  );
  if (process.env.DECKUSE_TEST_DEFAULT_ENGINE === '1') delete process.env.DECKUSE_DECK2HTML_BINARY;
  else process.env.DECKUSE_DECK2HTML_BINARY = binary;
  const convert = async (input, options) => {
    const result = await convertWithConfiguredBinary(input, options);
    const source = await readFile(result.indexHtmlPath, 'utf8');
    await writeFile(
      result.indexHtmlPath,
      source.replaceAll(
        'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js',
        pathToFileURL(require.resolve('echarts/dist/echarts.min.js')).href,
      ),
    );
    return result;
  };
  const rendered = await renderPage(workspaceId, { page: 2, dependencies: { convert } });
  assert.ok(rendered.output);
  const batch = await renderPages(workspaceId, {
    pages: [2, cases.length + 1],
    dependencies: { convert },
  });
  assert.equal(
    batch.results.every((p) => p.ok),
    true,
    JSON.stringify(batch),
  );
  const broken = async (input, options) => {
    const result = await convert(input, options);
    const source = await readFile(result.indexHtmlPath, 'utf8');
    await writeFile(
      result.indexHtmlPath,
      source.replace(
        '<script src="charts.js"></script>',
        '<script>echarts.init=function(){throw Error("Injected failure");};</script><script src="charts.js"></script>',
      ),
    );
    return result;
  };
  await assert.rejects(
    () => renderPage(workspaceId, { page: 2, dependencies: { convert: broken } }),
    { code: 'RENDER_CHART_FAILED' },
  );
  console.log('Deckuse single/batch render and failure propagation passed');
} finally {
  await browser.close();
}
