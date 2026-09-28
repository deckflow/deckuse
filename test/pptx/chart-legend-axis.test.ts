import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OpcArchive } from '../../src/opc/index.js';
import { pptxAdapter } from '../../src/pptx/index.js';

const e = new TextEncoder();
const CT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';

async function fixture(path: string) {
  const a = new OpcArchive();
  a.setPart(
    '/[Content_Types].xml',
    e.encode(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="${CT}"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
    ),
    'application/xml',
  );
  a.setPart(
    '/ppt/presentation.xml',
    e.encode(
      `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
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
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>`,
    ),
    'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  );
  a.setPart(
    '/docProps/app.xml',
    e.encode(
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>1</Slides></Properties>`,
    ),
    'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  );
  await a.writeFile(path);
}

const initWs = async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-chart-'));
  const source = join(root, 'source.pptx');
  const workspace = join(root, 'workspace');
  await fixture(source);
  const init = await pptxAdapter.init(
    { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
    {},
  );
  expect(init.ok).toBe(true);
  const revision = init.ok ? String((init.value as { revision: string }).revision) : '1';
  return { workspace, revision };
};

const addChart = async (
  workspace: string,
  revision: string,
  extra: Record<string, unknown> = {},
) => {
  const result = await pptxAdapter.execute(
    {
      version: '2.0',
      type: 'addShape',
      workspaceId: workspace,
      transactionId: revision,
      slide: 1,
      shapeType: 'chart',
      name: 'TestChart',
      chartType: 'column',
      x: '48px',
      y: '100px',
      width: '600px',
      height: '300px',
      data: {
        categories: ['A', 'B'],
        series: [{ name: 'S1', values: [10, 20], color: '051C2C' }],
      },
      ...extra,
    },
    {},
  );
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result;
};

const readChartXml = async (workspace: string): Promise<string> => {
  const inspected = await pptxAdapter.execute(
    { version: '2.0', type: 'inspect', workspaceId: workspace, depth: 2 },
    {},
  );
  expect(inspected.ok).toBe(true);
  const elements = (
    inspected.value as {
      elements: Array<{ name?: string; payload?: { chartPart?: string } }>;
    }
  ).elements;
  const chart = elements.find((el) => el.name === 'TestChart');
  expect(chart?.payload?.chartPart).toBeTruthy();
  return readFile(join(workspace, 'source', chart!.payload!.chartPart!.replace(/^\//, '')), 'utf8');
};

describe('chart legend / axis / fontSize', () => {
  it('column + legend:false omits c:legend', async () => {
    const { workspace, revision } = await initWs();
    await addChart(workspace, revision, { legend: false });
    const xml = await readChartXml(workspace);
    expect(xml).not.toContain('<c:legend>');
  });

  it('column + legend:"r" writes legendPos val=r', async () => {
    const { workspace, revision } = await initWs();
    await addChart(workspace, revision, { legend: 'r' });
    const xml = await readChartXml(workspace);
    expect(xml).toContain('<c:legendPos val="r"/>');
  });

  it('valueAxis.visible:false sets delete=1 on valAx', async () => {
    const { workspace, revision } = await initWs();
    await addChart(workspace, revision, { valueAxis: { visible: false } });
    const xml = await readChartXml(workspace);
    expect(xml).toMatch(/<c:valAx>[\s\S]*<c:delete val="1"\/>/);
  });

  it('valueAxis.min/max writes scaling min/max', async () => {
    const { workspace, revision } = await initWs();
    await addChart(workspace, revision, { valueAxis: { min: 0, max: 100 } });
    const xml = await readChartXml(workspace);
    expect(xml).toContain('<c:min val="0"/>');
    expect(xml).toContain('<c:max val="100"/>');
  });

  it('categoryAxis.visible:false sets delete=1 on catAx', async () => {
    const { workspace, revision } = await initWs();
    await addChart(workspace, revision, { categoryAxis: { visible: false } });
    const xml = await readChartXml(workspace);
    expect(xml).toMatch(/<c:catAx>[\s\S]*<c:delete val="1"\/>/);
  });

  it('fontSize:14 writes chartSpace txPr sz=1400', async () => {
    const { workspace, revision } = await initWs();
    await addChart(workspace, revision, { fontSize: 14 });
    const xml = await readChartXml(workspace);
    expect(xml).toMatch(/<c:txPr>[\s\S]*sz="1400"/);
  });

  it('pie + legend:"r" adds legend', async () => {
    const { workspace, revision } = await initWs();
    const result = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'chart',
        name: 'TestChart',
        chartType: 'pie',
        legend: 'r',
        data: {
          categories: ['A', 'B'],
          series: [{ name: 'S1', values: [40, 60] }],
        },
      },
      {},
    );
    expect(result.ok).toBe(true);
    const xml = await readChartXml(workspace);
    expect(xml).toContain('<c:legendPos val="r"/>');
  });

  it('setProperties legend:false removes existing legend', async () => {
    const { workspace, revision } = await initWs();
    const added = await addChart(workspace, revision);
    const rev2 = added.ok ? String((added.value as { revision: string }).revision) : revision;
    const styled = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setProperties',
        workspaceId: workspace,
        transactionId: rev2,
        target: 'slide:1/shape:TestChart',
        properties: { legend: false },
      },
      {},
    );
    expect(styled.ok).toBe(true);
    const xml = await readChartXml(workspace);
    expect(xml).not.toContain('<c:legend>');
  });

  it('setProperties valueAxis.visible:false sets delete=1', async () => {
    const { workspace, revision } = await initWs();
    const added = await addChart(workspace, revision);
    const rev2 = added.ok ? String((added.value as { revision: string }).revision) : revision;
    const styled = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setProperties',
        workspaceId: workspace,
        transactionId: rev2,
        target: 'slide:1/shape:TestChart',
        properties: { valueAxis: { visible: false } },
      },
      {},
    );
    expect(styled.ok).toBe(true);
    const xml = await readChartXml(workspace);
    expect(xml).toMatch(/<c:valAx>[\s\S]*<c:delete val="1"\/>/);
  });

  it('setProperties fontSize:16 updates txPr sz', async () => {
    const { workspace, revision } = await initWs();
    const added = await addChart(workspace, revision);
    const rev2 = added.ok ? String((added.value as { revision: string }).revision) : revision;
    const styled = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setProperties',
        workspaceId: workspace,
        transactionId: rev2,
        target: 'slide:1/shape:TestChart',
        properties: { fontSize: 16 },
      },
      {},
    );
    expect(styled.ok).toBe(true);
    const xml = await readChartXml(workspace);
    expect(xml).toMatch(/<c:txPr>[\s\S]*sz="1600"/);
  });

  it('default column chart still has bottom legend (regression)', async () => {
    const { workspace, revision } = await initWs();
    await addChart(workspace, revision);
    const xml = await readChartXml(workspace);
    expect(xml).toContain('<c:legendPos val="b"/>');
  });
});
