import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
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
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="${CT}"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/><Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`,
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
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr lang="en-US"/><a:t>Hel</a:t></a:r><a:r><a:rPr lang="zh-CN"/><a:t>lo</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/></p:nvGraphicFramePr><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Cell</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart"/></p:nvGraphicFramePr><a:graphic><a:graphicData><c:chart r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
    ),
    'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  );
  a.setRelationships('/ppt/slides/slide1.xml', [
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
      target: '../notesSlides/notesSlide1.xml',
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
    '/ppt/notesSlides/notesSlide1.xml',
    e.encode(
      `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Speaker note</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
    ),
    'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  );
  a.setPart(
    '/ppt/charts/chart1.xml',
    e.encode(
      `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Sales</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:v>Series A</c:v></c:tx><c:val><c:numRef><c:numCache><c:pt><c:v>42</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`,
    ),
    'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
  );
  a.setPart('/custom/unknown.bin', e.encode('keep me'));
  await a.writeFile(path);
}
describe('pptx adapter', () => {
  it('init inspect edit batch auto package reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-'));
    const source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    await fixture(source);
    const init = await pptxAdapter.init(
      { version: '1.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    expect(init, JSON.stringify(init)).toMatchObject({ ok: true });
    if (init.ok) {
      expect(init.value).toMatchObject({
        workspaceId: workspace,
        format: 'pptx',
        source,
        revision: expect.any(String),
        elementCount: expect.any(Number),
      });
      expect(init.value).not.toHaveProperty('elements');
      expect(init.value).not.toHaveProperty('metadata');
    }
    await expect(stat(join(workspace, 'source', 'ppt', 'presentation.xml'))).resolves.toBeDefined();
    await expect(readFile(join(workspace, '.gitignore'), 'utf8')).resolves.toContain('package.*');
    const inspected = await pptxAdapter.execute(
      { version: '1.0', type: 'inspect', workspaceId: workspace, depth: 2 },
      {},
    );
    expect(inspected.ok).toBe(true);
    const elements = (inspected as any).value.elements as any[];
    expect(elements.some((x) => x.kind === 'tableCell' && x.text === 'Cell')).toBe(true);
    expect(elements.some((x) => x.kind === 'notes' && x.text.includes('Speaker note'))).toBe(true);
    expect(
      elements.some((x) => x.kind === 'chart' && x.payload.series[0].values.includes('42')),
    ).toBe(true);
    const title = elements.find((x) => x.name === 'Title');
    const rev = (inspected as any).value.document.revision;
    const batch = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'batch',
        workspaceId: workspace,
        transactionId: rev,
        atomic: true,
        commands: [
          {
            version: '1.0',
            type: 'setText',
            workspaceId: workspace,
            transactionId: rev,
            ref: title.ref,
            text: 'Changed',
          },
          {
            version: '1.0',
            type: 'setTransform',
            workspaceId: workspace,
            transactionId: rev,
            ref: title.ref,
            transform: { x: 50 },
          },
          {
            version: '1.0',
            type: 'duplicate',
            workspaceId: workspace,
            transactionId: rev,
            ref: title.ref,
          },
        ],
      },
      {},
    );
    expect(batch, JSON.stringify(batch)).toMatchObject({ ok: true });
    const reopened = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    expect(new TextDecoder().decode(reopened.getPart('/ppt/slides/slide1.xml')!.data)).toContain(
      'Changed',
    );
    expect(new TextDecoder().decode(reopened.getPart('/custom/unknown.bin')!.data)).toBe('keep me');
    const history = await pptxAdapter.execute(
      { version: '1.0', type: 'history', workspaceId: workspace, limit: 10, offset: 0 },
      {},
    );
    expect(history.ok).toBe(true);
    if (history.ok) {
      expect((history.value as { total: number }).total).toBe(1);
      expect(
        (history.value as { records: Array<{ operation: { type: string }; slides: number[] }> })
          .records[0],
      ).toMatchObject({ operation: { type: 'batch' }, slides: [1] });
    }
    const undone = await pptxAdapter.execute(
      { version: '1.0', type: 'undo', workspaceId: workspace, steps: 1 },
      {},
    );
    expect(undone.ok).toBe(true);
    const afterUndo = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    expect(new TextDecoder().decode(afterUndo.getPart('/ppt/slides/slide1.xml')!.data)).not.toContain(
      'Changed',
    );
    expect((await readFile(join(workspace, 'package.pptx'))).length).toBeGreaterThan(0);
  });
  it('adds, duplicates and removes slides while maintaining presentation relationships', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-slide-'));
    const source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    await fixture(source);
    const init = await pptxAdapter.init(
      { version: '1.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    expect(init.ok).toBe(true);
    const inspected = await pptxAdapter.execute(
      { version: '1.0', type: 'inspect', workspaceId: workspace, depth: 2 },
      {},
    );
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const slide = (
      inspected.value as {
        elements: Array<{
          kind: string;
          ref: { documentId: string; elementId?: string; path?: string; revision?: string };
        }>;
      }
    ).elements.find((item) => item.kind === 'slide');
    expect(slide).toBeDefined();
    if (!slide) return;
    const duplicated = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'duplicate',
        workspaceId: workspace,
        transactionId: (inspected.value as { document: { revision: string } }).document.revision,
        ref: slide.ref,
      },
      {},
    );
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    const after = await pptxAdapter.execute(
      { version: '1.0', type: 'inspect', workspaceId: workspace, depth: 2 },
      {},
    );
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const slides = (
      after.value as {
        elements: Array<{
          kind: string;
          ref: { documentId: string; elementId?: string; path?: string; revision?: string };
        }>;
      }
    ).elements.filter((item) => item.kind === 'slide');
    expect(slides).toHaveLength(2);
    const removed = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'remove',
        workspaceId: workspace,
        transactionId: (after.value as { document: { revision: string } }).document.revision,
        ref: slides[1]!.ref,
      },
      {},
    );
    expect(removed.ok).toBe(true);
    const archive = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    expect(
      archive
        .getRelationships('/ppt/presentation.xml')
        .filter((rel) => rel.type.endsWith('/slide')),
    ).toHaveLength(1);
  });
  it('adds picture and table, queries structurally, and updates chart cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-elements-'));
    const source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    await fixture(source);
    const init = await pptxAdapter.init(
      { version: '1.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    expect(init.ok).toBe(true);
    const inspected = await pptxAdapter.execute(
      { version: '1.0', type: 'inspect', workspaceId: workspace, depth: 2 },
      {},
    );
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const value = inspected.value as {
      document: { revision: string };
      elements: Array<{
        kind: string;
        ref: { documentId: string; elementId?: string; path?: string; revision?: string };
      }>;
    };
    const slide = value.elements.find((x) => x.kind === 'slide'),
      chart = value.elements.find((x) => x.kind === 'chart');
    expect(slide && chart).toBeTruthy();
    if (!slide || !chart) return;
    const batch = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'batch',
        workspaceId: workspace,
        transactionId: value.document.revision,
        atomic: true,
        commands: [
          {
            version: '1.0',
            type: 'add',
            workspaceId: workspace,
            transactionId: value.document.revision,
            parent: slide.ref,
            element: {
              kind: 'picture',
              name: 'Pixel',
              base64: 'iVBORw0KGgo=',
              width: 100,
              height: 100,
            },
          },
          {
            version: '1.0',
            type: 'add',
            workspaceId: workspace,
            transactionId: value.document.revision,
            parent: slide.ref,
            element: {
              kind: 'table',
              name: 'SecondTable',
              rows: [
                ['A', 'B'],
                ['C', 'D'],
              ],
            },
          },
          {
            version: '1.0',
            type: 'setProperties',
            workspaceId: workspace,
            transactionId: value.document.revision,
            ref: chart.ref,
            properties: { series: [{ name: 'Updated', values: [99] }] },
          },
        ],
      },
      {},
    );
    expect(batch.ok).toBe(true);
    const pictures = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'query',
        workspaceId: workspace,
        selector: 'kind=picture',
        limit: 10,
      },
      {},
    );
    expect(pictures.ok).toBe(true);
    if (pictures.ok) {
      const list = pictures.value as Array<{
        name?: string;
        payload?: { href?: string; mediaPart?: string; fileName?: string };
      }>;
      expect(list).toHaveLength(1);
      expect(list[0]?.name).toBe('Pixel');
      expect(list[0]?.payload?.mediaPart).toMatch(/^\/ppt\/media\/image\d+\./);
      expect(list[0]?.payload?.href).toBe(
        join(workspace, 'source', 'ppt', 'media', list[0]!.payload!.fileName!),
      );
      expect(list[0]?.payload?.fileName).toMatch(/^image\d+\./);
      await expect(readFile(list[0]!.payload!.href!)).resolves.toBeInstanceOf(Buffer);
    }
    const queried = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'query',
        workspaceId: workspace,
        selector: { kind: 'table', name: 'Second' },
        limit: 10,
      },
      {},
    );
    expect(queried.ok).toBe(true);
    if (queried.ok) expect(queried.value).toHaveLength(1);
    const archive = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    expect([...archive.parts.keys()].some((name) => name.startsWith('/ppt/media/image'))).toBe(
      true,
    );
    expect(new TextDecoder().decode(archive.getPart('/ppt/charts/chart1.xml')!.data)).toContain(
      '99',
    );
  });
  it('queries with *, hasText, text~, replaceText, and auto package export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-replace-'));
    const source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    await fixture(source);
    expect(
      (
        await pptxAdapter.init(
          { version: '1.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
          {},
        )
      ).ok,
    ).toBe(true);
    const all = await pptxAdapter.execute(
      { version: '1.0', type: 'query', workspaceId: workspace, selector: '*', limit: 1000 },
      {},
    );
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect((all.value as unknown[]).length).toBeGreaterThan(3);
    const withText = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'query',
        workspaceId: workspace,
        selector: 'hasText=true',
        limit: 1000,
      },
      {},
    );
    expect(withText.ok).toBe(true);
    if (!withText.ok) return;
    const textItems = withText.value as Array<{ text?: string }>;
    expect(textItems.length).toBeGreaterThan(0);
    expect(textItems.every((item) => Boolean(item.text?.length))).toBe(true);
    const hello = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'query',
        workspaceId: workspace,
        selector: 'text~=^Hello$',
        limit: 10,
      },
      {},
    );
    expect(hello.ok).toBe(true);
    if (!hello.ok) return;
    expect(hello.value).toHaveLength(1);
    const rev = (
      (
        await pptxAdapter.execute(
          { version: '1.0', type: 'inspect', workspaceId: workspace, depth: 1 },
          {},
        )
      ).value as { document: { revision: string } }
    ).document.revision;
    const replaced = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'replaceText',
        workspaceId: workspace,
        transactionId: rev,
        find: 'Hello',
        replace: 'Bonjour',
        selector: 'kind=textbox',
      },
      {},
    );
    expect(replaced, JSON.stringify(replaced)).toMatchObject({
      ok: true,
      value: { matched: 1, changed: true, slides: [1] },
    });
    const committed = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    const slideXml = new TextDecoder().decode(committed.getPart('/ppt/slides/slide1.xml')!.data);
    expect(slideXml).toMatch(/<a:t>Bonjour\s*<\/a:t>/);
    expect(slideXml).not.toMatch(/<a:r>\s*<a:rPr[^>]*\/>\s*<\/a:r>/);
  });
  it('setProperties applies fill, stroke, and text styles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-props-'));
    const source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    await fixture(source);
    expect(
      (
        await pptxAdapter.init(
          { version: '1.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
          {},
        )
      ).ok,
    ).toBe(true);
    const inspected = await pptxAdapter.execute(
      { version: '1.0', type: 'inspect', workspaceId: workspace, depth: 2 },
      {},
    );
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const value = inspected.value as {
      document: { revision: string };
      elements: Array<{
        name?: string;
        ref: { documentId: string; elementId?: string; path?: string; revision?: string };
      }>;
    };
    const title = value.elements.find((item) => item.name === 'Title');
    expect(title).toBeDefined();
    if (!title) return;
    const updated = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'setProperties',
        workspaceId: workspace,
        transactionId: value.document.revision,
        ref: title.ref,
        properties: {
          border: { color: '0000FF', width: 2 },
          fill: 'FFEEEE',
          textColor: '003300',
          fontSize: 20,
          bold: true,
          name: 'Styled Title',
        },
      },
      {},
    );
    expect(updated, JSON.stringify(updated)).toMatchObject({ ok: true });
    const rejected = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'setProperties',
        workspaceId: workspace,
        transactionId: (updated.value as { revision: string }).revision,
        ref: {
          documentId: title.ref.documentId,
          elementId: title.ref.elementId,
        },
        properties: { glow: true },
      },
      {},
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe('INVALID_COMMAND');
    const xml = new TextDecoder().decode(
      (await OpcArchive.openFile(join(workspace, 'package.pptx'))).getPart(
        '/ppt/slides/slide1.xml',
      )!.data,
    );
    expect(xml).toContain('name="Styled Title"');
    expect(xml).toContain('<a:srgbClr val="0000FF"/>');
    expect(xml).toContain('<a:srgbClr val="FFEEEE"/>');
    expect(xml).toContain('<a:srgbClr val="003300"/>');
    expect(xml).toContain('w="25400"');
    expect(xml).toContain('sz="2000"');
    expect(xml).toContain('b="1"');
  });
  it('replacePicture keeps identity and remove cleans unreferenced media', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-picture-'));
    const source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    await fixture(source);
    expect(
      (
        await pptxAdapter.init(
          { version: '1.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
          {},
        )
      ).ok,
    ).toBe(true);
    const inspected = await pptxAdapter.execute(
      { version: '1.0', type: 'inspect', workspaceId: workspace, depth: 2 },
      {},
    );
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const value = inspected.value as {
      document: { revision: string };
      elements: Array<{
        kind: string;
        ref: { documentId: string; elementId?: string; path?: string; revision?: string };
      }>;
    };
    const slide = value.elements.find((x) => x.kind === 'slide');
    expect(slide).toBeTruthy();
    if (!slide) return;
    const pixel =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const added = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'add',
        workspaceId: workspace,
        transactionId: value.document.revision,
        parent: slide.ref,
        element: { kind: 'picture', name: 'Pixel', base64: pixel, width: 100, height: 100 },
      },
      {},
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const pictures = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'query',
        workspaceId: workspace,
        selector: 'kind=picture',
        limit: 10,
      },
      {},
    );
    expect(pictures.ok).toBe(true);
    if (!pictures.ok) return;
    const picture = (
      pictures.value as Array<{
        ref: { documentId: string; elementId?: string };
        location?: { cNvPrId?: string };
        payload?: { mediaPart?: string };
      }>
    )[0];
    expect(picture?.payload?.mediaPart).toBeTruthy();
    const mediaPart = picture!.payload!.mediaPart!;
    const before = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    const originalBytes = before.getPart(mediaPart)!.data.slice();
    const replaced = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'replacePicture',
        workspaceId: workspace,
        transactionId: (added.value as { revision: string }).revision,
        ref: picture!.ref,
        base64:
          'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6aAAAAAElFTkSuQmCC',
      },
      {},
    );
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    const afterReplace = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'query',
        workspaceId: workspace,
        selector: 'kind=picture',
        limit: 10,
      },
      {},
    );
    expect(afterReplace.ok).toBe(true);
    if (!afterReplace.ok) return;
    const nextPicture = (
      afterReplace.value as Array<{
        ref: { documentId: string; elementId?: string };
        location?: { cNvPrId?: string };
        payload?: { mediaPart?: string };
      }>
    )[0];
    expect(nextPicture?.ref.elementId).toBe(picture!.ref.elementId);
    expect(nextPicture?.location?.cNvPrId).toBe(picture!.location?.cNvPrId);
    expect(nextPicture?.payload?.mediaPart).toBe(mediaPart);
    const afterArchive = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    expect(
      Buffer.from(afterArchive.getPart(mediaPart)!.data).equals(Buffer.from(originalBytes)),
    ).toBe(false);
    const liveRef = {
      documentId: nextPicture!.ref.documentId,
      elementId: nextPicture!.ref.elementId,
    };
    const duplicated = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'duplicate',
        workspaceId: workspace,
        transactionId: (replaced.value as { revision: string }).revision,
        ref: liveRef,
      },
      {},
    );
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    const both = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'query',
        workspaceId: workspace,
        selector: 'kind=picture',
        limit: 10,
      },
      {},
    );
    expect(both.ok).toBe(true);
    if (!both.ok) return;
    const list = both.value as Array<{
      ref: { documentId: string; elementId?: string };
      payload?: { mediaPart?: string };
    }>;
    expect(list).toHaveLength(2);
    expect(list.every((item) => item.payload?.mediaPart === mediaPart)).toBe(true);
    const firstRef = {
      documentId: list[0]!.ref.documentId,
      elementId: list[0]!.ref.elementId,
    };
    const secondRef = {
      documentId: list[1]!.ref.documentId,
      elementId: list[1]!.ref.elementId,
    };
    const removeOne = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'remove',
        workspaceId: workspace,
        transactionId: (duplicated.value as { revision: string }).revision,
        ref: firstRef,
      },
      {},
    );
    expect(removeOne.ok).toBe(true);
    if (!removeOne.ok) return;
    expect(
      (await OpcArchive.openFile(join(workspace, 'package.pptx'))).getPart(mediaPart),
    ).toBeTruthy();
    const removeTwo = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'remove',
        workspaceId: workspace,
        transactionId: (removeOne.value as { revision: string }).revision,
        ref: secondRef,
      },
      {},
    );
    expect(removeTwo.ok).toBe(true);
    expect(
      (await OpcArchive.openFile(join(workspace, 'package.pptx'))).getPart(mediaPart),
    ).toBeUndefined();
  });
  it('rebuilds stale index.json when revision does not match manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-index-sync-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await fixture(source);
    const init = await pptxAdapter.init(
      { version: '1.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    expect(init.ok).toBe(true);
    const indexPath = join(workspace, '.deckuse', 'index.json');
    const manifestPath = join(workspace, '.deckuse', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { revision: string };
    const stale = JSON.parse(await readFile(indexPath, 'utf8')) as {
      revision: string;
      elements: unknown[];
    };
    stale.revision = 'stale-revision';
    stale.elements = [];
    await writeFile(indexPath, `${JSON.stringify(stale, null, 2)}\n`);
    const inspected = await pptxAdapter.execute(
      { version: '1.0', type: 'inspect', workspaceId: workspace, depth: 2 },
      {},
    );
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const elements = (inspected.value as { elements: unknown[] }).elements;
    expect(elements.length).toBeGreaterThan(0);
    expect((inspected.value as { document: { revision: string } }).document.revision).toBe(
      manifest.revision,
    );
    const persisted = JSON.parse(await readFile(indexPath, 'utf8')) as {
      revision: string;
      elements: unknown[];
    };
    expect(persisted.revision).toBe(manifest.revision);
    expect(persisted.elements.length).toBeGreaterThan(0);
  });
});
