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
  const root = await mkdtemp(join(tmpdir(), 'deckuse-text-'));
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

describe('text insets / spacing / baseline', () => {
  it('insets all zero writes lIns/rIns/tIns/bIns=0', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'text',
        name: 'T',
        insets: { left: 0, right: 0, top: 0, bottom: 0 },
        blocks: [{ text: 'Title' }],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toMatch(/<a:bodyPr[^>]*lIns="0"/);
    expect(xml).toMatch(/<a:bodyPr[^>]*rIns="0"/);
    expect(xml).toMatch(/<a:bodyPr[^>]*tIns="0"/);
    expect(xml).toMatch(/<a:bodyPr[^>]*bIns="0"/);
  });

  it('insets with pt units convert to EMU', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'text',
        name: 'T',
        insets: { left: '6pt', top: '4pt' },
        blocks: [{ text: 'Pad' }],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('lIns="76200"'); // 6pt
    expect(xml).toContain('tIns="50800"'); // 4pt
  });

  it('autofit shrink writes normAutofit', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'text',
        name: 'T',
        autofit: 'shrink',
        blocks: [{ text: 'Shrink' }],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('<a:normAutofit/>');
  });

  it('autofit resize writes spAutoFit', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'text',
        name: 'T',
        autofit: 'resize',
        blocks: [{ text: 'Resize' }],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('<a:spAutoFit/>');
  });

  it('autofit none writes noAutofit', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'text',
        name: 'T',
        autofit: 'none',
        blocks: [{ text: 'None' }],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('<a:noAutofit/>');
  });

  it('lineSpacing 1.1 writes spcPct 110000', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'text',
        name: 'T',
        blocks: [{ text: 'Line', lineSpacing: 1.1 }],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('<a:lnSpc><a:spcPct val="110000"/></a:lnSpc>');
  });

  it('spaceBefore 6pt writes spcBef spcPts 600', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'text',
        name: 'T',
        blocks: [{ text: 'Before', spaceBefore: '6pt' }],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('<a:spcBef><a:spcPts val="600"/></a:spcBef>');
  });

  it('spaceAfter 6pt writes spcAft spcPts 600', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'text',
        name: 'T',
        blocks: [{ text: 'After', spaceAfter: '6pt' }],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('<a:spcAft><a:spcPts val="600"/></a:spcAft>');
  });

  it('baseline super writes rPr baseline=30000', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'text',
        name: 'T',
        blocks: [
          {
            runs: [{ text: 'growth 12%' }, { text: '1', baseline: 'super' }],
          },
        ],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('baseline="30000"');
  });

  it('baseline sub writes rPr baseline=-25000', async () => {
    const { workspace, revision } = await initWs();
    await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'text',
        name: 'T',
        blocks: [{ runs: [{ text: 'H', baseline: 'sub' }, { text: '2O' }] }],
      },
      {},
    );
    const xml = await slideXml(workspace);
    expect(xml).toContain('baseline="-25000"');
  });

  it('setProperties insets/lineSpacing/spaceAfter/baseline round-trip', async () => {
    const { workspace, revision } = await initWs();
    const added = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'text',
        name: 'Insight',
        blocks: [{ text: 'Insight' }, { text: 'Body' }],
      },
      {},
    );
    expect(added.ok).toBe(true);
    const rev2 = added.ok ? String((added.value as { revision: string }).revision) : revision;
    const styled = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setProperties',
        workspaceId: workspace,
        transactionId: rev2,
        target: 'slide:1/shape:Insight',
        properties: {
          insets: { left: 0, top: 0 },
          lineSpacing: 1.15,
          spaceAfter: '6pt',
          baseline: 'super',
        },
      },
      {},
    );
    expect(styled.ok, JSON.stringify(styled)).toBe(true);
    const xml = await slideXml(workspace);
    expect(xml).toContain('lIns="0"');
    expect(xml).toContain('spcPct val="115000"');
    expect(xml).toContain('spcPts val="600"');
    expect(xml).toContain('baseline="30000"');
  });

  it('cover title with insets.left=0 aligns with color bar x (regression)', async () => {
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
            name: 'CoverBar',
            x: '64px',
            y: '240px',
            width: '80px',
            height: '6px',
            fill: { color: '2251FF' },
            stroke: 'none',
          },
          {
            version: '2.0',
            type: 'addShape',
            workspaceId: workspace,
            transactionId: revision,
            slide: 1,
            shapeType: 'text',
            name: 'CoverTitle',
            x: '64px',
            y: '260px',
            width: '900px',
            height: '120px',
            insets: { left: 0, right: 0, top: 0, bottom: 0 },
            blocks: [{ text: 'Title', fontSize: 36, bold: true }],
          },
        ],
      },
      {},
    );
    expect(batch.ok).toBe(true);
    const xml = await slideXml(workspace);
    // Both shapes share the same off.x; title has zero left inset so glyphs align with the bar.
    const offs = [...xml.matchAll(/<a:off x="(\d+)"/g)].map((m) => m[1]);
    expect(offs.filter((x) => x === offs[0]).length).toBeGreaterThanOrEqual(2);
    expect(xml).toContain('lIns="0"');
  });
});
