import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OpcArchive } from '@deckflow/deckuse-opc';
import { DOMParser } from '@xmldom/xmldom';
import { classifyChartDocument, editionMetadata, pptxAdapter } from '../src/index.js';

const e = new TextEncoder();
const CT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const layoutCt =
  'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml';
const masterCt =
  'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml';
const themeCt = 'application/vnd.openxmlformats-officedocument.theme+xml';
const chartCt = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';

async function packageWithMasters(path: string, chartFamily: 'barChart' | 'radarChart') {
  const a = new OpcArchive();
  a.setPart(
    '/[Content_Types].xml',
    e.encode(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="${CT}"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${layoutCt}"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${masterCt}"/><Override PartName="/ppt/theme/theme1.xml" ContentType="${themeCt}"/><Override PartName="/ppt/charts/chart1.xml" ContentType="${chartCt}"/></Types>`,
    ),
    'application/xml',
  );
  a.setPart(
    '/ppt/presentation.xml',
    e.encode(
      `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    ),
    CT,
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
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>SlideTitle</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart"/></p:nvGraphicFramePr><a:graphic><a:graphicData><c:chart r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
    ),
    'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  );
  a.setRelationships('/ppt/slides/slide1.xml', [
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
      target: '../slideLayouts/slideLayout1.xml',
      external: false,
    },
    {
      id: 'rId2',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
      target: '../charts/chart1.xml',
      external: false,
    },
  ]);
  a.setPart(
    '/ppt/slideLayouts/slideLayout1.xml',
    e.encode(
      `<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="LayoutTitle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>LayoutText</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`,
    ),
    layoutCt,
  );
  a.setRelationships('/ppt/slideLayouts/slideLayout1.xml', [
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
      target: '../slideMasters/slideMaster1.xml',
      external: false,
    },
  ]);
  a.setPart(
    '/ppt/slideMasters/slideMaster1.xml',
    e.encode(
      `<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="MasterTitle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>MasterText</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sldMaster>`,
    ),
    masterCt,
  );
  a.setRelationships('/ppt/slideMasters/slideMaster1.xml', [
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
      target: '../theme/theme1.xml',
      external: false,
    },
  ]);
  a.setPart(
    '/ppt/theme/theme1.xml',
    e.encode(
      `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="Office"><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`,
    ),
    themeCt,
  );
  a.setPart(
    '/ppt/charts/chart1.xml',
    e.encode(
      `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Sales</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:${chartFamily}><c:ser><c:tx><c:v>Series A</c:v></c:tx><c:val><c:numLit><c:ptCount val="1"/><c:pt idx="0"><c:v>42</c:v></c:pt></c:numLit></c:val></c:ser></c:${chartFamily}></c:plotArea></c:chart></c:chartSpace>`,
    ),
    chartCt,
  );
  await a.writeFile(path);
}

describe('community edition write gates', () => {
  it('exposes community edition metadata on status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-edition-status-'));
    const source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    await packageWithMasters(source, 'barChart');
    const init = await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    expect(init.ok).toBe(true);
    const status = await pptxAdapter.execute(
      { version: '2.0', type: 'status', workspaceId: workspace },
      {},
    );
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value).toMatchObject(editionMetadata);
    expect((status.value as { capabilities: { edition: string } }).capabilities.edition).toBe(
      'community',
    );
  });

  it('allows list masters/layouts and rejects master/layout/theme writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-edition-mlt-'));
    const source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    await packageWithMasters(source, 'barChart');
    const init = await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    const rev = (init.value as { revision: string }).revision;

    const layouts = await pptxAdapter.execute(
      { version: '2.0', type: 'list', workspaceId: workspace, resource: 'layouts' },
      {},
    );
    expect(layouts.ok).toBe(true);

    const masters = await pptxAdapter.execute(
      { version: '2.0', type: 'list', workspaceId: workspace, resource: 'masters' },
      {},
    );
    expect(masters.ok).toBe(true);

    for (const target of ['master:slideMaster1', 'layout:slideLayout1', 'theme']) {
      const denied = await pptxAdapter.execute(
        {
          version: '2.0',
          type: 'setText',
          workspaceId: workspace,
          transactionId: rev,
          target,
          text: 'Nope',
        },
        {},
      );
      expect(denied.ok, target).toBe(false);
      if (!denied.ok) expect(denied.error.code).toBe('UNSUPPORTED_CAPABILITY');
    }

    const slideOk = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setText',
        workspaceId: workspace,
        transactionId: rev,
        target: 'slide:1/shape:2',
        text: 'StillOk',
      },
      {},
    );
    expect(slideOk.ok).toBe(true);
    expect(await readFile(join(workspace, 'source/ppt/slides/slide1.xml'), 'utf8')).toContain(
      'StillOk',
    );
  });

  it('allows basic chart writes and rejects advanced chart writes', async () => {
    const basicRoot = await mkdtemp(join(tmpdir(), 'deckuse-edition-basic-chart-'));
    const basicSource = join(basicRoot, 'source.pptx'),
      basicWs = join(basicRoot, 'workspace');
    await packageWithMasters(basicSource, 'barChart');
    const basicInit = await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: basicWs, format: 'pptx', source: basicSource },
      {},
    );
    expect(basicInit.ok).toBe(true);
    if (!basicInit.ok) return;
    const basicWrite = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setText',
        workspaceId: basicWs,
        transactionId: (basicInit.value as { revision: string }).revision,
        target: 'slide:1/shape:4',
        text: 'BasicTitle',
      },
      {},
    );
    expect(basicWrite.ok).toBe(true);

    const basicList = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'list',
        workspaceId: basicWs,
        resource: 'shapes',
        slide: 1,
      },
      {},
    );
    expect(basicList.ok).toBe(true);
    if (basicList.ok) {
      const chart = (basicList.value as { items: Array<{ kind: string; chartVariant?: string }> })
        .items.find((i) => i.kind === 'chart');
      expect(chart?.chartVariant).toBe('basic');
    }

    const advRoot = await mkdtemp(join(tmpdir(), 'deckuse-edition-adv-chart-'));
    const advSource = join(advRoot, 'source.pptx'),
      advWs = join(advRoot, 'workspace');
    await packageWithMasters(advSource, 'radarChart');
    const advInit = await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: advWs, format: 'pptx', source: advSource },
      {},
    );
    expect(advInit.ok).toBe(true);
    if (!advInit.ok) return;
    const advWrite = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setText',
        workspaceId: advWs,
        transactionId: (advInit.value as { revision: string }).revision,
        target: 'slide:1/shape:4',
        text: 'AdvancedTitle',
      },
      {},
    );
    expect(advWrite.ok).toBe(false);
    if (!advWrite.ok) expect(advWrite.error.code).toBe('UNSUPPORTED_CAPABILITY');

    const advList = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'list',
        workspaceId: advWs,
        resource: 'shapes',
        slide: 1,
      },
      {},
    );
    expect(advList.ok).toBe(true);
    if (advList.ok) {
      const chart = (advList.value as { items: Array<{ kind: string; chartVariant?: string }> })
        .items.find((i) => i.kind === 'chart');
      expect(chart?.chartVariant).toBe('advanced');
    }
  });

  it('classifies chart families as basic or advanced', () => {
    const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
    expect(
      classifyChartDocument(
        parse(
          `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:pieChart/></c:plotArea></c:chart></c:chartSpace>`,
        ),
      ),
    ).toBe('basic');
    expect(
      classifyChartDocument(
        parse(
          `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart/><c:lineChart/></c:plotArea></c:chart></c:chartSpace>`,
        ),
      ),
    ).toBe('advanced');
    expect(
      classifyChartDocument(
        parse(
          `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:radarChart/></c:plotArea></c:chart></c:chartSpace>`,
        ),
      ),
    ).toBe('advanced');
  });
});
