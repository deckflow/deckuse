import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OpcArchive } from '../../src/opc/index.js';
import { pptxAdapter } from '../../src/pptx/index.js';

const e = new TextEncoder();
const CT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const MARKER = 'IT-smoke';

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
  a.setRelationships('/ppt/slides/slide1.xml', []);
  a.setPart(
    '/docProps/app.xml',
    e.encode(
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>1</Slides></Properties>`,
    ),
    'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  );
  await a.writeFile(path);
}

describe('pptx write smoke (L0 semantic)', () => {
  it('batches writes, validates, reopens package, and read-backs IT markers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-write-smoke-'));
    const source = join(root, 'in.pptx');
    const workspace = join(root, 'ws');
    await fixture(source);

    const init = await pptxAdapter.init({
      version: '2.0',
      type: 'init',
      workspaceId: workspace,
      format: 'pptx',
      source,
    });
    expect(init.ok).toBe(true);
    const revision = init.ok ? String((init.value as { revision: string }).revision) : '1';

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
            name: `${MARKER}-rect`,
            x: 100_000,
            y: 100_000,
            width: 1_000_000,
            height: 500_000,
          },
          {
            version: '2.0',
            type: 'addShape',
            workspaceId: workspace,
            transactionId: revision,
            slide: 1,
            shapeType: 'text',
            name: `${MARKER}-text`,
            text: `${MARKER} hello`,
            x: 200_000,
            y: 800_000,
            width: 2_000_000,
            height: 400_000,
          },
        ],
      },
      {},
    );
    expect(batch, JSON.stringify(batch)).toMatchObject({ ok: true });

    const validated = await pptxAdapter.execute(
      { version: '2.0', type: 'validate', workspaceId: workspace },
      {},
    );
    expect(validated.ok).toBe(true);

    const listed = await pptxAdapter.execute(
      { version: '2.0', type: 'list', workspaceId: workspace, resource: 'shapes', slide: 1 },
      {},
    );
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const items = (
      listed.value as { items: Array<{ name?: string; textPreview?: string; target?: string }> }
    ).items;
    const markers = items.filter(
      (item) =>
        (item.name?.includes(MARKER) ?? false) ||
        (item.textPreview?.includes(MARKER) ?? false) ||
        (item.target?.includes(MARKER) ?? false),
    );
    expect(markers.length).toBeGreaterThanOrEqual(2);

    const textItem = markers.find((m) => m.name === `${MARKER}-text`);
    expect(textItem?.textPreview ?? '').toContain(MARKER);
    expect(textItem?.target).toBeDefined();

    const packed = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    expect(packed.getPart('/[Content_Types].xml')).toBeDefined();
    expect(packed.getPart('/ppt/presentation.xml')).toBeDefined();
    const slideXml = new TextDecoder().decode(packed.getPart('/ppt/slides/slide1.xml')!.data);
    expect(slideXml).toContain(MARKER);
    expect(slideXml).toContain(`${MARKER}-rect`);

    const sourceXml = await readFile(join(workspace, 'source/ppt/slides/slide1.xml'), 'utf8');
    expect(sourceXml).toContain(`${MARKER} hello`);
  });
});
