import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

  it('dry-run same-batch forward refs and multi-run blocks', async () => {
    const { workspace, revision } = await initWs();
    const dry = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'batch',
        workspaceId: workspace,
        transactionId: revision,
        atomic: true,
        dryRun: true,
        commands: [
          {
            version: '2.0',
            type: 'addShape',
            workspaceId: workspace,
            transactionId: revision,
            slide: 1,
            shapeType: 'rounded-rect',
            name: 'RunCard',
            x: '5%',
            y: '100px',
            width: '40%',
            height: '80px',
            cornerRadius: 0.2,
            wrap: 'none',
            blocks: [
              {
                align: 'center',
                runs: [
                  { text: 'C', textColor: 'DC2626', bold: true, fontSize: 20 },
                  { text: 'ustomer', textColor: '111827', fontSize: 20 },
                ],
              },
            ],
          },
          {
            version: '2.0',
            type: 'setProperties',
            workspaceId: workspace,
            transactionId: revision,
            target: 'slide:1/shape:RunCard',
            properties: { 'paragraph.align': 'center', fill: { color: 'F8FAFC' } },
          },
        ],
      },
      {},
    );
    expect(dry, JSON.stringify(dry)).toMatchObject({ ok: true });
    if (dry.ok) expect((dry.value as { dryRun?: boolean }).dryRun).toBe(true);
  });

  it('addShape arrow and elbow connectors', async () => {
    const { workspace, revision } = await initWs();
    const result = await pptxAdapter.execute(
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
            shapeType: 'arrow',
            name: 'Arrow1',
            x: 100,
            y: 100,
            width: 200000,
            height: 100000,
            fill: { color: '2563EB' },
          },
          {
            version: '2.0',
            type: 'addShape',
            workspaceId: workspace,
            transactionId: revision,
            slide: 1,
            shapeType: 'elbow',
            name: 'Elbow1',
            x: 100,
            y: 300000,
            width: 400000,
            height: 200000,
            stroke: { color: '111827', width: 1.5, headEnd: 'triangle' },
          },
        ],
      },
      {},
    );
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const xml = await readFile(join(workspace, 'source', 'ppt', 'slides', 'slide1.xml'), 'utf8');
    expect(xml).toContain('prst="rightArrow"');
    expect(xml).toContain('prst="bentConnector3"');
    expect(xml).toContain('headEnd');
  });

  it('addShape chevron and circular-arrow presets', async () => {
    const { workspace, revision } = await initWs();
    const result = await pptxAdapter.execute(
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
            shapeType: 'chevron',
            name: 'Ch1',
            x: 100,
            y: 100,
            width: 300000,
            height: 100000,
          },
          {
            version: '2.0',
            type: 'addShape',
            workspaceId: workspace,
            transactionId: revision,
            slide: 1,
            shapeType: 'circular-arrow',
            name: 'Loop1',
            x: 100,
            y: 300000,
            width: 200000,
            height: 200000,
          },
        ],
      },
      {},
    );
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const xml = await readFile(join(workspace, 'source', 'ppt', 'slides', 'slide1.xml'), 'utf8');
    expect(xml).toContain('prst="chevron"');
    expect(xml).toContain('prst="circularArrow"');
  });

  it('blocks runs with newlines become multiple paragraphs', async () => {
    const { workspace, revision } = await initWs();
    const result = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'text',
        name: 'MultiLine',
        x: 100,
        y: 100,
        width: 900000,
        height: 300000,
        blocks: [{ runs: [{ text: 'LineA\nLineB', fontSize: 14 }] }],
      },
      {},
    );
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const xml = await readFile(join(workspace, 'source', 'ppt', 'slides', 'slide1.xml'), 'utf8');
    expect(xml).toContain('<a:t>LineA</a:t>');
    expect(xml).toContain('<a:t>LineB</a:t>');
    expect(xml).not.toMatch(/<a:t>[^<]*\n[^<]*<\/a:t>/);
  });

  it('table fixed short height emits TABLE_HEIGHT_MAY_CLIP', async () => {
    const { workspace, revision } = await initWs();
    const result = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'table',
        name: 'ClipTable',
        x: '5%',
        y: '100px',
        width: '90%',
        height: 50_000,
        rows: [
          ['指标', '很长很长很长很长很长很长的中文内容需要折行显示'],
          ['Q1', '100'],
          ['全年合计', '999'],
        ],
      },
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.some((d) => d.code === 'TABLE_HEIGHT_MAY_CLIP')).toBe(true);
  });

  it('export repacks from source; fromPackage skips; packageStale flips', async () => {
    const { workspace } = await initWs();
    const slidePath = join(workspace, 'source', 'ppt', 'slides', 'slide1.xml');
    const original = await readFile(slidePath, 'utf8');
    await writeFile(slidePath, original.replace('</p:sld>', '<!--hand-edit--></p:sld>'));

    const statusDirty = await pptxAdapter.execute(
      { version: '2.0', type: 'status', workspaceId: workspace },
      {},
    );
    expect(statusDirty.ok).toBe(true);
    if (statusDirty.ok)
      expect((statusDirty.value as { packageStale?: boolean }).packageStale).toBe(true);

    const outDefault = join(workspace, '..', 'out-repack.pptx');
    const exported = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'export',
        workspaceId: workspace,
        output: outDefault,
      },
      {},
    );
    expect(exported, JSON.stringify(exported)).toMatchObject({
      ok: true,
      value: { repacked: true, fromPackage: false },
    });
    const packed = await OpcArchive.openFile(outDefault);
    expect(new TextDecoder().decode(packed.getPart('/ppt/slides/slide1.xml')!.data)).toContain(
      'hand-edit',
    );

    const statusClean = await pptxAdapter.execute(
      { version: '2.0', type: 'status', workspaceId: workspace },
      {},
    );
    expect(statusClean.ok).toBe(true);
    if (statusClean.ok)
      expect((statusClean.value as { packageStale?: boolean }).packageStale).toBe(false);

    await writeFile(slidePath, original.replace('</p:sld>', '<!--again--></p:sld>'));
    const outSnap = join(workspace, '..', 'out-snap.pptx');
    const snap = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'export',
        workspaceId: workspace,
        output: outSnap,
        fromPackage: true,
      },
      {},
    );
    expect(snap).toMatchObject({ ok: true, value: { repacked: false, fromPackage: true } });
    const snapArc = await OpcArchive.openFile(outSnap);
    expect(new TextDecoder().decode(snapArc.getPart('/ppt/slides/slide1.xml')!.data)).not.toContain(
      'again',
    );
  });

  it('setTableLayout content redistribution updates row heights', async () => {
    const { workspace, revision } = await initWs();
    const created = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'table',
        name: 'LayoutTable',
        x: '5%',
        y: '100px',
        width: '90%',
        height: 'auto',
        rows: [
          ['A', 'B'],
          ['很长很长很长很长很长的内容', '2'],
        ],
      },
      {},
    );
    expect(created.ok).toBe(true);
    const rev2 = (
      (await pptxAdapter.execute({ version: '2.0', type: 'status', workspaceId: workspace }, {}))
        .value as { revision: string }
    ).revision;
    const laid = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setTableLayout',
        workspaceId: workspace,
        transactionId: rev2,
        target: 'slide:1/shape:LayoutTable',
        height: 'auto',
        redistribute: 'content',
      },
      {},
    );
    expect(laid, JSON.stringify(laid)).toMatchObject({ ok: true });
    const xml = await readFile(join(workspace, 'source', 'ppt', 'slides', 'slide1.xml'), 'utf8');
    expect(xml).toMatch(/<a:tr h="\d+"/);
  });
});
