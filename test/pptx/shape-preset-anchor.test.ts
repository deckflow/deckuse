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
  const root = await mkdtemp(join(tmpdir(), 'deckuse-shape-'));
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

describe('shape preset / default anchor / harvey-ball', () => {
  it('rect without anchor defaults to anchor=ctr', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'rect',
        name: 'Card',
        blocks: [{ text: 'Centered' }],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('anchor="ctr"');
  });

  it('text without anchor has no default ctr', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'text',
        name: 'Title',
        blocks: [{ text: 'Top' }],
      },
      {},
    );
    const xml = await slideXml(workspace);
    // textbox should not force vertical center
    expect(xml).not.toMatch(/name="Title"[\s\S]*anchor="ctr"/);
  });

  it('rect + explicit anchor:t wins over default', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'rect',
        name: 'TopCard',
        anchor: 't',
        blocks: [{ text: 'Top' }],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('anchor="t"');
  });

  it('preset pie is valid', async () => {
    const { workspace, revision } = await initWs();
    const result = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'preset',
        preset: 'pie',
        name: 'Pie',
        width: '40px',
        height: '40px',
      },
      {},
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const xml = await slideXml(workspace);
    expect(xml).toContain('prst="pie"');
  });

  it('preset blockArc is valid', async () => {
    const { workspace, revision } = await initWs();
    const result = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'preset',
        preset: 'blockArc',
        name: 'Arc',
      },
      {},
    );
    expect(result.ok).toBe(true);
    const xml = await slideXml(workspace);
    expect(xml).toContain('prst="blockArc"');
  });

  it('preset leftBrace is valid', async () => {
    const { workspace, revision } = await initWs();
    const result = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'preset',
        preset: 'leftBrace',
        name: 'Brace',
      },
      {},
    );
    expect(result.ok).toBe(true);
    const xml = await slideXml(workspace);
    expect(xml).toContain('prst="leftBrace"');
  });

  it('preset invalidShape returns INVALID_COMMAND', async () => {
    const { workspace, revision } = await initWs();
    const result = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'preset',
        preset: 'invalidShape',
        name: 'Bad',
      },
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_COMMAND');
  });

  it('preset pie + adjust adj=0.5 writes gd fmla', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'preset',
        preset: 'pie',
        name: 'AdjPie',
        adjust: { adj: 0.5 },
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('name="adj"');
    expect(xml).toContain('fmla="val 50000"');
  });

  it('harvey-ball value=0.5 generates pie with adj', async () => {
    const { workspace, revision } = await initWs();
    const result = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'harvey-ball',
        name: 'HB',
        value: 0.5,
        width: '24px',
        height: '24px',
        fill: { color: '051C2C' },
      },
      {},
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const xml = await slideXml(workspace);
    expect(xml).toContain('prst="pie"');
    expect(xml).toContain('name="adj"');
    expect(xml).toContain('fmla="val 10800000"');
  });

  it('chevron text defaults to vertical center (regression)', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'chevron',
        name: 'P1',
        width: '390px',
        height: '56px',
        fill: { color: '051C2C' },
        stroke: 'none',
        blocks: [
          { text: '0–6个月：验证', fontSize: 14, bold: true, textColor: 'FFFFFF', align: 'center' },
        ],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('prst="chevron"');
    expect(xml).toContain('anchor="ctr"');
  });
});
