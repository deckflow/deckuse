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
  const root = await mkdtemp(join(tmpdir(), 'deckuse-table-cw-'));
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

const slideXml = (workspace: string) =>
  readFile(join(workspace, 'source', 'ppt', 'slides', 'slide1.xml'), 'utf8');

describe('table columnWidths / merges / default font', () => {
  it('percentage columnWidths write proportional gridCol widths', async () => {
    const { workspace, revision } = await initWs();
    const result = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'table',
        name: 'T',
        width: '1000px',
        height: 'auto',
        columnWidths: ['28%', '10%', '10%', '10%', '10%', '32%'],
        rows: [
          ['战略选项', 'A', 'B', 'C', 'D', '评价'],
          ['A. 高端出海（欧洲/中东）', '●', '●', '◕', '◑', '优先'],
        ],
      },
      {},
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const xml = await slideXml(workspace);
    const widths = [...xml.matchAll(/<a:gridCol w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(6);
    // 28% and 32% should be the widest columns
    expect(widths[0]!).toBeGreaterThan(widths[1]!);
    expect(widths[5]!).toBeGreaterThan(widths[1]!);
    expect(widths[0]! / widths[5]!).toBeCloseTo(28 / 32, 1);
  });

  it('columnWidths sum ≠ 100% normalizes with warning', async () => {
    const { workspace, revision } = await initWs();
    const result = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'table',
        name: 'T',
        width: '500px',
        columnWidths: ['40%', '40%'],
        rows: [
          ['A', 'B'],
          ['1', '2'],
        ],
      },
      {},
    );
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((d) => d.code === 'COLUMN_WIDTHS_NORMALIZED')).toBe(true);
    const xml = await slideXml(workspace);
    const widths = [...xml.matchAll(/<a:gridCol w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(widths[0]).toBe(widths[1]);
  });

  it('absolute px columnWidths', async () => {
    const { workspace, revision } = await initWs();
    const result = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'table',
        name: 'T',
        width: '300px',
        columnWidths: ['200px', '100px'],
        rows: [
          ['A', 'B'],
          ['1', '2'],
        ],
      },
      {},
    );
    expect(result.ok).toBe(true);
    const xml = await slideXml(workspace);
    const widths = [...xml.matchAll(/<a:gridCol w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(widths[0]! / widths[1]!).toBeCloseTo(2, 1);
  });

  it('without columnWidths uses equal split (regression)', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'table',
        name: 'T',
        width: '400px',
        rows: [
          ['A', 'B', 'C', 'D'],
          ['1', '2', '3', '4'],
        ],
      },
      {},
    );
    const xml = await slideXml(workspace);
    const widths = [...xml.matchAll(/<a:gridCol w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(new Set(widths).size).toBe(1);
  });

  it('vertical merge writes rowSpan + vMerge', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'table',
        name: 'T',
        merges: [{ from: '0:0', to: '1:0' }],
        rows: [
          ['Merged', 'B'],
          ['', 'D'],
        ],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('rowSpan="2"');
    expect(xml).toContain('vMerge="1"');
  });

  it('horizontal merge writes gridSpan + hMerge', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'table',
        name: 'T',
        merges: [{ from: '0:0', to: '0:2' }],
        rows: [
          ['A', '', ''],
          ['1', '2', '3'],
        ],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('gridSpan="3"');
    expect(xml).toContain('hMerge="1"');
  });

  it('setProperties columnWidths updates tblGrid', async () => {
    const { workspace, revision } = await initWs();
    const added = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'table',
        name: 'T',
        width: '400px',
        rows: [
          ['A', 'B'],
          ['1', '2'],
        ],
      },
      {},
    );
    expect(added.ok).toBe(true);
    const rev2 = added.ok ? String((added.value as { revision: string }).revision) : revision;
    const updated = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setProperties',
        workspaceId: workspace,
        transactionId: rev2,
        target: 'slide:1/shape:T',
        properties: { columnWidths: ['70%', '30%'] },
      },
      {},
    );
    expect(updated.ok, JSON.stringify(updated)).toBe(true);
    const xml = await slideXml(workspace);
    const widths = [...xml.matchAll(/<a:gridCol w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(widths[0]! / widths[1]!).toBeCloseTo(70 / 30, 1);
  });

  it('setProperties cell merge writes rowSpan', async () => {
    const { workspace, revision } = await initWs();
    const added = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'table',
        name: 'T',
        rows: [
          ['A', 'B'],
          ['C', 'D'],
        ],
      },
      {},
    );
    expect(added.ok).toBe(true);
    const rev2 = added.ok ? String((added.value as { revision: string }).revision) : revision;
    const updated = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setProperties',
        workspaceId: workspace,
        transactionId: rev2,
        target: 'slide:1/shape:T/cell:0:0',
        properties: { merge: { rowSpan: 2 } },
      },
      {},
    );
    expect(updated.ok, JSON.stringify(updated)).toBe(true);
    const xml = await slideXml(workspace);
    expect(xml).toContain('rowSpan="2"');
  });

  it('option matrix first/last columns are wider than middle', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'table',
        name: 'OptionTable',
        width: '1184px',
        height: 'auto',
        columnWidths: ['28%', '10%', '10%', '10%', '10%', '32%'],
        rows: [
          ['战略选项', '市场规模', '增长潜力', '能力匹配', '投资强度', '综合评价'],
          ['A. 高端出海（欧洲/中东）', '●', '●', '◕', '◑', '优先推进：品牌溢价+渠道先发'],
        ],
      },
      {},
    );
    const xml = await slideXml(workspace);
    const widths = [...xml.matchAll(/<a:gridCol w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(widths[0]!).toBeGreaterThan(widths[1]! * 2);
    expect(widths[5]!).toBeGreaterThan(widths[1]! * 2);
  });

  it('cell XML does not hardcode lang=zh-CN / sz=1100 for Latin text', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'table',
        name: 'T',
        fontSize: 12,
        fontFamily: 'Arial',
        rows: [
          ['Hello', 'World'],
          ['1', '2'],
        ],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('lang="en-US"');
    expect(xml).toContain('sz="1200"');
    expect(xml).toContain('typeface="Arial"');
    // Must not still hardcode the old defaults for Latin cells
    expect(xml).not.toMatch(/lang="zh-CN" sz="1100"/);
  });
});
