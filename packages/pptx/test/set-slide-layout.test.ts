import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OpcArchive } from '@deckflow/deckuse-opc';
import { pptxAdapter } from '../src/index.js';
import { naturalCompare, orderedLayouts } from '../src/layout-ref.js';
import type { IndexFile } from '../src/types.js';

const e = new TextEncoder();
const CT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const layoutCt = 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml';
const slideCt = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';

async function fixtureTwoLayoutsTwoSlides(path: string) {
  const a = new OpcArchive();
  a.setPart(
    '/[Content_Types].xml',
    e.encode(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="${CT}"/><Override PartName="/ppt/slides/slide1.xml" ContentType="${slideCt}"/><Override PartName="/ppt/slides/slide2.xml" ContentType="${slideCt}"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${layoutCt}"/><Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="${layoutCt}"/><Override PartName="/ppt/slideLayouts/slideLayout10.xml" ContentType="${layoutCt}"/></Types>`,
    ),
    'application/xml',
  );
  a.setPart(
    '/ppt/presentation.xml',
    e.encode(
      `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    ),
    CT,
  );
  a.setRelationships('/ppt/presentation.xml', [
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
      target: 'slides/slide1.xml',
      external: false,
      resolvedTarget: '/ppt/slides/slide1.xml',
    },
    {
      id: 'rId2',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
      target: 'slides/slide2.xml',
      external: false,
      resolvedTarget: '/ppt/slides/slide2.xml',
    },
  ]);
  a.setPart(
    '/ppt/slides/slide1.xml',
    e.encode(
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>KeepMe</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    ),
    slideCt,
  );
  a.setRelationships('/ppt/slides/slide1.xml', [
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
      target: '../slideLayouts/slideLayout1.xml',
      external: false,
      resolvedTarget: '/ppt/slideLayouts/slideLayout1.xml',
    },
  ]);
  a.setPart(
    '/ppt/slides/slide2.xml',
    e.encode(
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>`,
    ),
    slideCt,
  );
  a.setRelationships('/ppt/slides/slide2.xml', [
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
      target: '../slideLayouts/slideLayout2.xml',
      external: false,
      resolvedTarget: '/ppt/slideLayouts/slideLayout2.xml',
    },
  ]);
  // Intentionally add layouts out of numeric insertion order (10 before 2) to
  // prove list/index uses natural basename order, not Map insertion order.
  a.setPart(
    '/ppt/slideLayouts/slideLayout10.xml',
    e.encode(
      `<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="obj"><p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>`,
    ),
    layoutCt,
  );
  a.setPart(
    '/ppt/slideLayouts/slideLayout1.xml',
    e.encode(
      `<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="title"><p:cSld name="Title Slide"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>`,
    ),
    layoutCt,
  );
  a.setPart(
    '/ppt/slideLayouts/slideLayout2.xml',
    e.encode(
      `<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>`,
    ),
    layoutCt,
  );
  a.setPart(
    '/docProps/app.xml',
    e.encode(
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>2</Slides><Notes>0</Notes></Properties>`,
    ),
    'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  );
  await a.writeFile(path);
}

describe('naturalCompare / orderedLayouts', () => {
  it('orders slideLayout2 before slideLayout10', () => {
    expect(naturalCompare('slideLayout2', 'slideLayout10')).toBeLessThan(0);
    const index: IndexFile = {
      revision: '1',
      elements: [
        {
          ref: { documentId: 'w', elementId: 'a', path: '/ppt/slideLayouts/slideLayout10.xml' },
          kind: 'layout',
          partUri: '/ppt/slideLayouts/slideLayout10.xml',
        },
        {
          ref: { documentId: 'w', elementId: 'b', path: '/ppt/slideLayouts/slideLayout2.xml' },
          kind: 'layout',
          partUri: '/ppt/slideLayouts/slideLayout2.xml',
        },
        {
          ref: { documentId: 'w', elementId: 'c', path: '/ppt/slideLayouts/slideLayout1.xml' },
          kind: 'layout',
          partUri: '/ppt/slideLayouts/slideLayout1.xml',
        },
      ],
    };
    expect(orderedLayouts(index).map((i) => i.partUri)).toEqual([
      '/ppt/slideLayouts/slideLayout1.xml',
      '/ppt/slideLayouts/slideLayout2.xml',
      '/ppt/slideLayouts/slideLayout10.xml',
    ]);
  });
});

describe('setSlideLayout', () => {
  it('rebinds by index, layout:N, slide:N, and preserves shape text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-set-layout-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await fixtureTwoLayoutsTwoSlides(source);

    const init = await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    let revision = (init.value as { revision: string }).revision;

    const listed = await pptxAdapter.execute(
      { version: '2.0', type: 'list', workspaceId: workspace, resource: 'layouts' },
      {},
    );
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const layouts = (listed.value as { items: Array<{ index: number; name: string; displayName: string }> })
      .items;
    expect(layouts.map((l) => l.name)).toEqual([
      'slideLayout1',
      'slideLayout2',
      'slideLayout10',
    ]);
    expect(layouts[1]?.displayName).toBe('Blank');
    expect(layouts[1]?.index).toBe(2);

    const slidesBefore = await pptxAdapter.execute(
      { version: '2.0', type: 'list', workspaceId: workspace, resource: 'slides' },
      {},
    );
    expect(slidesBefore.ok).toBe(true);
    if (!slidesBefore.ok) return;
    const slide1Before = (
      slidesBefore.value as {
        items: Array<{ layout?: { target: string; displayName: string; index?: number } }>;
      }
    ).items[0];
    expect(slide1Before?.layout?.target).toBe('layout:slideLayout1');
    expect(slide1Before?.layout?.displayName).toBe('Title Slide');
    expect(slide1Before?.layout?.index).toBe(1);

    const byIndex = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setSlideLayout',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        layout: '2',
      },
      {},
    );
    expect(byIndex.ok).toBe(true);
    if (!byIndex.ok) return;
    revision = (byIndex.value as { revision: string }).revision;

    let rels = await readFile(join(workspace, 'source/ppt/slides/_rels/slide1.xml.rels'), 'utf8');
    expect(rels).toContain('slideLayout2.xml');
    expect(rels).not.toContain('slideLayout1.xml');

    const slideXml = await readFile(join(workspace, 'source/ppt/slides/slide1.xml'), 'utf8');
    expect(slideXml).toContain('KeepMe');

    const idempotent = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setSlideLayout',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        layout: 'layout:2',
      },
      {},
    );
    expect(idempotent.ok).toBe(true);
    if (!idempotent.ok) return;
    expect((idempotent.value as { changed?: boolean }).changed).toBe(false);
    revision = (idempotent.value as { revision: string }).revision;

    // Switch slide1 to use slide2's layout (already Blank / layout 2) then to layout 3 (slideLayout10)
    // via slide:2 after first putting slide2 on layout 3.
    const slide2ToThree = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setSlideLayout',
        workspaceId: workspace,
        transactionId: revision,
        slide: 2,
        layout: '3',
      },
      {},
    );
    expect(slide2ToThree.ok).toBe(true);
    if (!slide2ToThree.ok) return;
    revision = (slide2ToThree.value as { revision: string }).revision;

    const fromSlide = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setSlideLayout',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        layout: 'slide:2',
      },
      {},
    );
    expect(fromSlide.ok).toBe(true);
    if (!fromSlide.ok) return;

    rels = await readFile(join(workspace, 'source/ppt/slides/_rels/slide1.xml.rels'), 'utf8');
    expect(rels).toContain('slideLayout10.xml');
    expect(await readFile(join(workspace, 'source/ppt/slides/slide1.xml'), 'utf8')).toContain(
      'KeepMe',
    );

    const slidesAfter = await pptxAdapter.execute(
      { version: '2.0', type: 'list', workspaceId: workspace, resource: 'slides' },
      {},
    );
    expect(slidesAfter.ok).toBe(true);
    if (!slidesAfter.ok) return;
    const s1 = (
      slidesAfter.value as { items: Array<{ layout?: { target: string; index?: number } }> }
    ).items[0];
    expect(s1?.layout?.target).toBe('layout:slideLayout10');
    expect(s1?.layout?.index).toBe(3);
  });

  it('addSlide accepts layout index and slide:N', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-add-layout-ref-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await fixtureTwoLayoutsTwoSlides(source);

    const init = await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    let revision = (init.value as { revision: string }).revision;

    const byIndex = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addSlide',
        workspaceId: workspace,
        transactionId: revision,
        layout: '2',
      },
      {},
    );
    expect(byIndex.ok).toBe(true);
    if (!byIndex.ok) return;
    revision = (byIndex.value as { revision: string }).revision;

    const rels3 = await readFile(join(workspace, 'source/ppt/slides/_rels/slide3.xml.rels'), 'utf8');
    expect(rels3).toContain('slideLayout2.xml');

    const bySlide = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addSlide',
        workspaceId: workspace,
        transactionId: revision,
        layout: 'slide:1',
      },
      {},
    );
    expect(bySlide.ok).toBe(true);
    if (!bySlide.ok) return;

    const rels4 = await readFile(join(workspace, 'source/ppt/slides/_rels/slide4.xml.rels'), 'utf8');
    expect(rels4).toContain('slideLayout1.xml');
  });

  it('rejects out-of-range layout index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-set-layout-bad-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await fixtureTwoLayoutsTwoSlides(source);

    const init = await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    const revision = (init.value as { revision: string }).revision;

    const bad = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setSlideLayout',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        layout: '99',
      },
      {},
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.code).toBe('TARGET_NOT_FOUND');
  });
});
