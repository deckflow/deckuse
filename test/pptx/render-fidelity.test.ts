import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OpcArchive } from '../../src/opc/index.js';
import { chartRenderDiagnostics } from '../../src/pptx/render-fidelity.js';
import { pptxAdapter } from '../../src/pptx/index.js';
import { renderPage } from '../../src/render.js';

const e = new TextEncoder();
const PRESENTATION_CT =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';

describe('chartRenderDiagnostics', () => {
  it('emits combo and series-color codes for a combo chart page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-render-fid-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    const a = new OpcArchive();
    a.setPart(
      '/[Content_Types].xml',
      e.encode(
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="${PRESENTATION_CT}"/><Override PartName="/ppt/slides/slide1.xml" ContentType="${SLIDE_CT}"/></Types>`,
      ),
      'application/xml',
    );
    a.setPart(
      '/ppt/presentation.xml',
      e.encode(
        `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
      ),
      PRESENTATION_CT,
    );
    a.setRelationships('/ppt/presentation.xml', [
      {
        id: 'rId1',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
        target: 'slides/slide1.xml',
        external: false,
      },
    ]);
    a.setPart(
      '/ppt/slides/slide1.xml',
      e.encode(
        `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>`,
      ),
      SLIDE_CT,
    );
    a.setPart(
      '/docProps/app.xml',
      e.encode(
        `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>1</Slides></Properties>`,
      ),
      'application/vnd.openxmlformats-officedocument.extended-properties+xml',
    );
    await a.writeFile(source);
    await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    const added = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: 'latest',
        slide: 1,
        shapeType: 'chart',
        chartType: 'combo',
        x: '5%',
        y: '10%',
        width: '90%',
        height: '70%',
        data: {
          categories: ['Q1', 'Q2'],
          series: [
            { name: 'Rev', values: [10, 20], color: '5B8DEF', chart: 'column' },
            { name: 'Margin', values: [1, 2], color: 'F0A500', chart: 'line' },
          ],
        },
      },
      {},
    );
    expect(added.ok).toBe(true);
    const archive = await OpcArchive.openDirectory(join(workspace, 'source'));
    const diagnostics = chartRenderDiagnostics(archive, 1);
    expect(diagnostics.some((d) => d.code === 'COMBO_CHART_RENDER_LIMITED')).toBe(true);
    expect(diagnostics.some((d) => d.code === 'CHART_SERIES_COLOR_UNVERIFIED')).toBe(true);
    expect(chartRenderDiagnostics(archive, 2)).toEqual([]);

    const rendered = await renderPage(workspace, {
      page: 1,
      dependencies: {
        convert: async (_input, options) => {
          await writeFile(join(options.output, 'index.html'), '<html><div id="deck"></div></html>');
          return {
            indexHtmlPath: join(options.output, 'index.html'),
            exitCode: 0,
            stdout: '',
            stderr: '',
          };
        },
        screenshot: async (opts) => {
          await mkdir(dirname(opts.outputPath), { recursive: true });
          await writeFile(opts.outputPath, 'png');
        },
      },
    });
    expect(rendered.diagnostics.some((d) => d.code === 'COMBO_CHART_RENDER_LIMITED')).toBe(true);
    expect(rendered.warnings.some((w) => w.startsWith('COMBO_CHART_RENDER_LIMITED:'))).toBe(true);
  });

  it('emits only series-color code for a basic column chart with srgbClr', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-render-col-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    const a = new OpcArchive();
    a.setPart(
      '/[Content_Types].xml',
      e.encode(
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="${PRESENTATION_CT}"/><Override PartName="/ppt/slides/slide1.xml" ContentType="${SLIDE_CT}"/></Types>`,
      ),
      'application/xml',
    );
    a.setPart(
      '/ppt/presentation.xml',
      e.encode(
        `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
      ),
      PRESENTATION_CT,
    );
    a.setRelationships('/ppt/presentation.xml', [
      {
        id: 'rId1',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
        target: 'slides/slide1.xml',
        external: false,
      },
    ]);
    a.setPart(
      '/ppt/slides/slide1.xml',
      e.encode(
        `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>`,
      ),
      SLIDE_CT,
    );
    a.setPart(
      '/docProps/app.xml',
      e.encode(
        `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>1</Slides></Properties>`,
      ),
      'application/vnd.openxmlformats-officedocument.extended-properties+xml',
    );
    await a.writeFile(source);
    await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    const added = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: 'latest',
        slide: 1,
        shapeType: 'chart',
        chartType: 'column',
        x: '5%',
        y: '10%',
        width: '90%',
        height: '70%',
        data: {
          categories: ['Q1'],
          series: [{ name: 'Rev', values: [10], color: '112233' }],
        },
      },
      {},
    );
    expect(added.ok).toBe(true);
    const archive = await OpcArchive.openDirectory(join(workspace, 'source'));
    const diagnostics = chartRenderDiagnostics(archive, 1);
    expect(diagnostics.some((d) => d.code === 'CHART_SERIES_COLOR_UNVERIFIED')).toBe(true);
    expect(diagnostics.some((d) => d.code === 'COMBO_CHART_RENDER_LIMITED')).toBe(false);
  });
});
