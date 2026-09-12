import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OpcArchive } from '@deckflow/deckuse-opc';
import { pptxAdapter } from '../src/index.js';

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
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Hello</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
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
  const root = await mkdtemp(join(tmpdir(), 'deckuse-agent-'));
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

describe('agent batch UX', () => {
  it('same-batch addShape then setText/setProperties by name', async () => {
    const { workspace, revision } = await initWs();
    const batch = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'batch',
        workspaceId: workspace,
        transactionId: revision,
        atomic: true,
        commands: [
          {
            version: '2.0',
            type: 'addShape',
            workspaceId: workspace,
            transactionId: revision,
            slide: 1,
            shapeType: 'rect',
            name: 'KpiCard',
            x: '5%',
            y: '120px',
            width: '28%',
            height: '80px',
          },
          {
            version: '2.0',
            type: 'setProperties',
            workspaceId: workspace,
            transactionId: revision,
            target: 'slide:1/shape:KpiCard',
            properties: {
              fill: { color: 'F0FDF4' },
              stroke: { color: 'BBF7D0', width: 1 },
            },
          },
          {
            version: '2.0',
            type: 'setText',
            workspaceId: workspace,
            transactionId: revision,
            target: 'slide:1/shape:KpiCard',
            blocks: [
              { text: '总营收', fontSize: 12, textColor: '065F46' },
              { text: '598', fontSize: 24, bold: true, textColor: '059669' },
            ],
          },
        ],
      },
      {},
    );
    expect(batch, JSON.stringify(batch)).toMatchObject({ ok: true });
    const xml = await readFile(join(workspace, 'source', 'ppt', 'slides', 'slide1.xml'), 'utf8');
    expect(xml).toContain('KpiCard');
    expect(xml).toContain('F0FDF4');
    expect(xml).toContain('总营收');
    expect(xml).toContain('598');
  });

  it('setProperties accepts dotted keys via normalizer', async () => {
    const { workspace, revision } = await initWs();
    const result = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setProperties',
        workspaceId: workspace,
        transactionId: revision,
        target: 'slide:1/shape:Title',
        properties: {
          'font.size': 18,
          'font.color': '112233',
          'font.weight': 'bold',
          'fill.color': 'ABCDEF',
          'line.color': '445566',
          'line.width': 1.5,
        },
      },
      {},
    );
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const xml = await readFile(join(workspace, 'source', 'ppt', 'slides', 'slide1.xml'), 'utf8');
    expect(xml).toContain('ABCDEF');
    expect(xml).toContain('445566');
    expect(xml).toMatch(/sz="18\d+"/);
    expect(xml).toContain('112233');
    expect(xml).toContain('b="1"');
  });

  it('addShape applies inline fill/stroke/blocks and warns on combo', async () => {
    const { workspace, revision } = await initWs();
    const styled = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'rect',
        name: 'InlineCard',
        x: '5%',
        y: '200px',
        width: '40%',
        height: '90px',
        fill: { color: 'EFF6FF' },
        stroke: { color: 'BFDBFE', width: 1 },
        blocks: [
          { text: 'Label', fontSize: 11, textColor: '1E40AF' },
          { text: '42', fontSize: 22, bold: true, textColor: '2563EB' },
        ],
      },
      {},
    );
    expect(styled, JSON.stringify(styled)).toMatchObject({ ok: true });
    const xml = await readFile(join(workspace, 'source', 'ppt', 'slides', 'slide1.xml'), 'utf8');
    expect(xml).toContain('InlineCard');
    expect(xml).toContain('EFF6FF');
    expect(xml).toContain('Label');
    expect(xml).toContain('42');

    const rev2 = styled.ok ? String((styled.value as { revision: string }).revision) : revision;
    const combo = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: rev2,
        slide: 1,
        shapeType: 'chart',
        chartType: 'combo',
        x: '5%',
        y: '320px',
        width: '90%',
        height: '300px',
        data: {
          categories: ['Q1', 'Q2'],
          series: [
            { name: 'Rev', values: [10, 20], chart: 'column' },
            { name: 'Margin', values: [0.1, 0.2], chart: 'line', axis: 'secondary' },
          ],
        },
      },
      {},
    );
    expect(combo.ok).toBe(true);
    expect(combo.diagnostics.some((d) => d.code === 'COMBO_CHART_RENDER_LIMITED')).toBe(true);
  });
});
