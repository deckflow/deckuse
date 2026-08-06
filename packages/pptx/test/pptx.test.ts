import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OpcArchive } from '@deckuse/opc';
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
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Hello</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/></p:nvGraphicFramePr><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Cell</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart"/></p:nvGraphicFramePr><a:graphic><a:graphicData><c:chart r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
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
  it('init inspect edit batch commit reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-'));
    const source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace'),
      out = join(root, 'out.pptx');
    await fixture(source);
    const init = await pptxAdapter.init(
      { version: '1.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    expect(init, JSON.stringify(init)).toMatchObject({ ok: true });
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
    const newRev = (batch as any).value.revision;
    expect(
      (
        await pptxAdapter.execute(
          {
            version: '1.0',
            type: 'commit',
            workspaceId: workspace,
            transactionId: newRev,
            destination: out,
          },
          {},
        )
      ).ok,
    ).toBe(true);
    const reopened = await OpcArchive.openFile(out);
    expect(new TextDecoder().decode(reopened.getPart('/ppt/slides/slide1.xml')!.data)).toContain(
      'Changed',
    );
    expect(new TextDecoder().decode(reopened.getPart('/custom/unknown.bin')!.data)).toBe('keep me');
    expect((await readFile(out)).length).toBeGreaterThan(0);
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
  it('queries with *, hasText, text~, replaceText, and commit overwrite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-replace-'));
    const source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace'),
      out = join(root, 'out.pptx');
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
      value: { matched: 1, changed: true },
    });
    const newRev = (replaced.value as { revision: string }).revision;
    const firstCommit = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'commit',
        workspaceId: workspace,
        transactionId: newRev,
        destination: out,
      },
      {},
    );
    expect(firstCommit.ok).toBe(true);
    const blocked = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'commit',
        workspaceId: workspace,
        transactionId: newRev,
        destination: out,
      },
      {},
    );
    expect(blocked.ok).toBe(false);
    const forced = await pptxAdapter.execute(
      {
        version: '1.0',
        type: 'commit',
        workspaceId: workspace,
        transactionId: newRev,
        destination: out,
        overwrite: true,
      },
      {},
    );
    expect(forced.ok).toBe(true);
    expect(await readFile(out)).toBeTruthy();
  });
});
