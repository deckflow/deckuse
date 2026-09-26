import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OpcArchive } from '../../src/opc/index.js';
import { pptxAdapter } from '../../src/pptx/index.js';
import { resolveProperties } from '../../src/pptx/resolve-properties.js';
import { REL } from '../../src/pptx/xml.js';

const e = new TextEncoder();
const CT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const NOTES_CT = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';

async function writeArchive(path: string, build: (a: OpcArchive) => void): Promise<void> {
  const a = new OpcArchive();
  build(a);
  await a.writeFile(path);
}

const baseParts = (a: OpcArchive): void => {
  a.setPart(
    '/[Content_Types].xml',
    e.encode(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="${CT}"/><Override PartName="/ppt/slides/slide1.xml" ContentType="${SLIDE_CT}"/><Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="${NOTES_CT}"/></Types>`,
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
    '/docProps/app.xml',
    e.encode(
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>1</Slides><Notes>1</Notes></Properties>`,
    ),
    'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  );
};

describe('agent regression: notes / undo / setText / table / changedParts', () => {
  it('replaceText and get notes only touch body placeholder (not hdr/sldNum)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-notes-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await writeArchive(source, (a) => {
      baseParts(a);
      a.setPart(
        '/ppt/slides/slide1.xml',
        e.encode(
          `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Slide body</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
        ),
        SLIDE_CT,
      );
      a.setRelationships('/ppt/slides/slide1.xml', [
        {
          id: 'rId1',
          type: REL.notes,
          target: '../notesSlides/notesSlide1.xml',
          external: false,
        },
      ]);
      a.setPart(
        '/ppt/notesSlides/notesSlide1.xml',
        e.encode(
          `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Header Placeholder 1"/><p:cNvSpPr/><p:nvPr><p:ph type="hdr"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>HeaderOnly</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 4"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>青蛙的一生</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>3</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
        ),
        NOTES_CT,
      );
      a.setRelationships('/ppt/notesSlides/notesSlide1.xml', [
        {
          id: 'rId1',
          type: REL.slide,
          target: '../slides/slide1.xml',
          external: false,
        },
      ]);
    });

    const init = await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    expect(init.ok).toBe(true);

    const got = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'get',
        workspaceId: workspace,
        target: 'slide:1/notes',
        props: ['text.value'],
      },
      {},
    );
    expect(got.ok).toBe(true);
    if (got.ok) {
      const text = (got.value as { properties: Record<string, { effective?: unknown }> })
        .properties['text.value']?.effective;
      expect(text).toBe('青蛙的一生');
      expect(text).not.toBe('3');
      expect(String(text)).not.toContain('HeaderOnly');
    }

    const replaced = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'replaceText',
        workspaceId: workspace,
        transactionId: 'latest',
        find: '青蛙',
        replace: '蝌蚪',
        regex: false,
      },
      {},
    );
    expect(replaced.ok).toBe(true);

    const notesXml = await readFile(
      join(workspace, 'source/ppt/notesSlides/notesSlide1.xml'),
      'utf8',
    );
    expect(notesXml).toContain('蝌蚪的一生');
    expect(notesXml).toContain('HeaderOnly');
    expect(notesXml).toContain('>3<');
    expect(notesXml).not.toContain('青蛙');

    const after = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'get',
        workspaceId: workspace,
        target: 'slide:1/notes',
        props: ['text.value'],
      },
      {},
    );
    expect(after.ok).toBe(true);
    if (after.ok) {
      const text = (after.value as { properties: Record<string, { effective?: unknown }> })
        .properties['text.value']?.effective;
      expect(text).toBe('蝌蚪的一生');
      expect(String(text).length).toBeLessThan(20);
    }
  });

  it('get notes on slide without notes part returns empty text (no empty-path IO_ERROR)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-nonotes-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await writeArchive(source, (a) => {
      a.setPart(
        '/[Content_Types].xml',
        e.encode(
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="${CT}"/><Override PartName="/ppt/slides/slide1.xml" ContentType="${SLIDE_CT}"/></Types>`,
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
          `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Hi</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
        ),
        SLIDE_CT,
      );
      a.setRelationships('/ppt/slides/slide1.xml', []);
      a.setPart(
        '/docProps/app.xml',
        e.encode(
          `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>1</Slides><Notes>0</Notes></Properties>`,
        ),
        'application/vnd.openxmlformats-officedocument.extended-properties+xml',
      );
    });

    await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    const got = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'get',
        workspaceId: workspace,
        target: 'slide:1/notes',
        props: ['text.value'],
      },
      {},
    );
    expect(got.ok).toBe(true);
    if (got.ok) {
      const text = (got.value as { properties: Record<string, { effective?: unknown }> })
        .properties['text.value']?.effective;
      expect(text).toBeNull();
    }
  });

  it('duplicate slide retargets notes→slide; validate catches mismatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-dup-notes-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await writeArchive(source, (a) => {
      baseParts(a);
      a.setPart(
        '/ppt/slides/slide1.xml',
        e.encode(
          `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>One</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
        ),
        SLIDE_CT,
      );
      a.setRelationships('/ppt/slides/slide1.xml', [
        {
          id: 'rId1',
          type: REL.notes,
          target: '../notesSlides/notesSlide1.xml',
          external: false,
        },
      ]);
      a.setPart(
        '/ppt/notesSlides/notesSlide1.xml',
        e.encode(
          `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Note</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
        ),
        NOTES_CT,
      );
      a.setRelationships('/ppt/notesSlides/notesSlide1.xml', [
        {
          id: 'rId1',
          type: REL.slide,
          target: '../slides/slide1.xml',
          external: false,
        },
      ]);
    });

    await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );

    const dup = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'duplicate',
        workspaceId: workspace,
        transactionId: 'latest',
        target: 'slide:1',
      },
      {},
    );
    expect(dup.ok).toBe(true);

    const pack = await OpcArchive.openDirectory(join(workspace, 'source'));
    const slide2Notes = pack
      .getRelationships('/ppt/slides/slide2.xml')
      .find((r) => r.type === REL.notes);
    expect(slide2Notes?.resolvedTarget).toBeTruthy();
    const back = pack
      .getRelationships(slide2Notes!.resolvedTarget!)
      .find((r) => r.type === REL.slide);
    expect(back?.resolvedTarget).toBe('/ppt/slides/slide2.xml');

    // Corrupt the back-pointer and expect validate to report NOTES_SLIDE_MISMATCH.
    pack.setRelationships(slide2Notes!.resolvedTarget!, [
      {
        id: 'rId1',
        type: REL.slide,
        target: '../slides/slide1.xml',
        external: false,
        resolvedTarget: '/ppt/slides/slide1.xml',
      },
    ]);
    await pack.writeDirectory(join(workspace, 'source'), true);

    const validated = await pptxAdapter.execute(
      { version: '2.0', type: 'validate', workspaceId: workspace },
      {},
    );
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.diagnostics.some((d) => d.code === 'NOTES_SLIDE_MISMATCH')).toBe(true);
    }
  });

  it('undo after duplicate removes orphan slide/notes parts from source and package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-undo-orphan-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await writeArchive(source, (a) => {
      baseParts(a);
      a.setPart(
        '/ppt/slides/slide1.xml',
        e.encode(
          `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>One</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
        ),
        SLIDE_CT,
      );
      a.setRelationships('/ppt/slides/slide1.xml', [
        {
          id: 'rId1',
          type: REL.notes,
          target: '../notesSlides/notesSlide1.xml',
          external: false,
        },
      ]);
      a.setPart(
        '/ppt/notesSlides/notesSlide1.xml',
        e.encode(
          `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Note</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
        ),
        NOTES_CT,
      );
      a.setRelationships('/ppt/notesSlides/notesSlide1.xml', [
        {
          id: 'rId1',
          type: REL.slide,
          target: '../slides/slide1.xml',
          external: false,
        },
      ]);
    });

    await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );

    const beforeSlides = await readdir(join(workspace, 'source/ppt/slides'));
    const beforeNotes = await readdir(join(workspace, 'source/ppt/notesSlides'));

    const dup = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'duplicate',
        workspaceId: workspace,
        transactionId: 'latest',
        target: 'slide:1',
      },
      {},
    );
    expect(dup.ok).toBe(true);

    const undone = await pptxAdapter.execute(
      { version: '2.0', type: 'undo', workspaceId: workspace, steps: 1 },
      {},
    );
    expect(undone.ok).toBe(true);

    const afterSlides = await readdir(join(workspace, 'source/ppt/slides'));
    const afterNotes = await readdir(join(workspace, 'source/ppt/notesSlides'));
    expect(afterSlides.sort()).toEqual(beforeSlides.sort());
    expect(afterNotes.sort()).toEqual(beforeNotes.sort());

    const pack = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    expect(pack.getPart('/ppt/slides/slide2.xml')).toBeUndefined();
    expect(
      [...pack.parts.keys()].filter((n) => n.startsWith('/ppt/notesSlides/notesSlide')).length,
    ).toBe(1);
  });

  it('setText preserves paragraph.align center (a:pPr)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-settext-ppr-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await writeArchive(source, (a) => {
      a.setPart(
        '/[Content_Types].xml',
        e.encode(
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="${CT}"/><Override PartName="/ppt/slides/slide1.xml" ContentType="${SLIDE_CT}"/></Types>`,
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
          `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Centered"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US"/><a:t>Old</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
        ),
        SLIDE_CT,
      );
      a.setRelationships('/ppt/slides/slide1.xml', []);
      a.setPart(
        '/docProps/app.xml',
        e.encode(
          `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>1</Slides></Properties>`,
        ),
        'application/vnd.openxmlformats-officedocument.extended-properties+xml',
      );
    });

    await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    const set = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setText',
        workspaceId: workspace,
        transactionId: 'latest',
        target: 'slide:1/shape:2',
        text: 'New centered',
      },
      {},
    );
    expect(set.ok).toBe(true);
    const xml = await readFile(join(workspace, 'source/ppt/slides/slide1.xml'), 'utf8');
    expect(xml).toContain('algn="ctr"');
    expect(xml).toContain('New centered');
  });

  it('insertRow inherits row height and cell align; cell path supports paragraph.align', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-table-row-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await writeArchive(source, (a) => {
      a.setPart(
        '/[Content_Types].xml',
        e.encode(
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="${CT}"/><Override PartName="/ppt/slides/slide1.xml" ContentType="${SLIDE_CT}"/></Types>`,
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
          `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="1574800"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="2000000"/><a:gridCol w="2000000"/></a:tblGrid><a:tr h="660400"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:t>H1</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:t>H2</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr><a:tr h="914400"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:t>A</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:t>B</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
        ),
        SLIDE_CT,
      );
      a.setRelationships('/ppt/slides/slide1.xml', []);
      a.setPart(
        '/docProps/app.xml',
        e.encode(
          `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>1</Slides></Properties>`,
        ),
        'application/vnd.openxmlformats-officedocument.extended-properties+xml',
      );
    });

    await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );

    const inserted = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setProperties',
        workspaceId: workspace,
        transactionId: 'latest',
        target: 'slide:1/shape:3',
        properties: { insertRow: { index: 2, cells: ['C', 'D'] } },
      },
      {},
    );
    expect(inserted.ok).toBe(true);

    const xml = await readFile(join(workspace, 'source/ppt/slides/slide1.xml'), 'utf8');
    expect(xml).toMatch(/<a:tr h="914400">[\s\S]*C/);
    expect(xml).toContain('algn="ctr"');
    expect(xml).toContain('cy="2489200"'); // 1574800 + 914400

    const cellAlign = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setProperties',
        workspaceId: workspace,
        transactionId: 'latest',
        target: 'slide:1/shape:3/cell:0:0',
        properties: { 'paragraph.align': 'left' },
      },
      {},
    );
    expect(cellAlign.ok).toBe(true);
    const after = await readFile(join(workspace, 'source/ppt/slides/slide1.xml'), 'utf8');
    expect(after).toContain('algn="l"');

    const readBack = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'get',
        workspaceId: workspace,
        target: 'slide:1/shape:3/cell:0:0',
        props: ['text.value', 'paragraph.align'],
      },
      {},
    );
    expect(readBack.ok).toBe(true);
    if (readBack.ok) {
      const properties = (
        readBack.value as {
          properties: Record<string, { effective?: unknown; source?: { scope?: string } }>;
        }
      ).properties;
      expect(properties['text.value']?.effective).toBe('H1');
      expect(properties['paragraph.align']?.effective).toBe('l');
    }

    const unsupported = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'get',
        workspaceId: workspace,
        target: 'slide:1/shape:3/cell:0:0',
        props: ['font.size'],
      },
      {},
    );
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) expect(unsupported.error.code).toBe('UNSUPPORTED_PROPERTY');
  });

  it('get of a table cell whose XML node is missing is an error', async () => {
    const archive = new OpcArchive();
    archive.setPart(
      '/ppt/slides/slide1.xml',
      e.encode(
        `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>`,
      ),
      SLIDE_CT,
    );
    const details = resolveProperties(
      archive,
      {
        target: 'slide:1/shape:3/cell:0:0',
        uid: 'missing-cell',
        item: {
          ref: { documentId: 'doc', elementId: '256:3:cell:0:0' },
          kind: 'tableCell',
          partUri: '/ppt/slides/slide1.xml',
          location: { tableId: '256:3', row: 0, column: 0 },
        },
        parsed: { raw: 'slide:1/shape:3/cell:0:0', kind: 'tableCell' },
      },
      { props: ['text.value'] },
    );
    expect(details.ok).toBe(false);
    if (!details.ok) expect(details.error.code).toBe('ELEMENT_NOT_FOUND');
  });

  it('unset table cell paragraph.align reads back as null default', async () => {
    const archive = new OpcArchive();
    archive.setPart(
      '/ppt/slides/slide1.xml',
      e.encode(
        `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="100"/></a:tblGrid><a:tr h="100"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Plain</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
      ),
      SLIDE_CT,
    );
    const details = resolveProperties(
      archive,
      {
        target: 'slide:1/shape:3/cell:0:0',
        uid: 'plain-cell',
        item: {
          ref: { documentId: 'doc', elementId: '256:3:cell:0:0' },
          kind: 'tableCell',
          partUri: '/ppt/slides/slide1.xml',
          location: { tableId: '256:3', row: 0, column: 0 },
        },
        parsed: { raw: 'slide:1/shape:3/cell:0:0', kind: 'tableCell' },
      },
      { props: ['paragraph.align', 'text.value'] },
    );
    expect(details.ok).toBe(true);
    if (!details.ok) return;
    const align = details.value.properties['paragraph.align'] as {
      effective?: unknown;
      source?: { scope?: string };
    };
    expect(align.effective).toBeNull();
    expect(align.source?.scope).toBe('default');
    expect((details.value.properties['text.value'] as { effective?: unknown }).effective).toBe(
      'Plain',
    );
  });

  it('fixed 600x200px table row heights sum to the frame', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-table-frame-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await writeArchive(source, (a) => {
      a.setPart(
        '/[Content_Types].xml',
        e.encode(
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="${CT}"/><Override PartName="/ppt/slides/slide1.xml" ContentType="${SLIDE_CT}"/></Types>`,
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
          `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>`,
        ),
        SLIDE_CT,
      );
      a.setPart(
        '/docProps/app.xml',
        e.encode(
          `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>1</Slides></Properties>`,
        ),
        'application/vnd.openxmlformats-officedocument.extended-properties+xml',
      );
    });
    const init = await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    expect(init.ok).toBe(true);
    const revision = init.ok ? String((init.value as { revision: string }).revision) : '1';
    const created = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'addShape',
        workspaceId: workspace,
        transactionId: revision,
        slide: 1,
        shapeType: 'table',
        name: 'Sized',
        x: '0px',
        y: '0px',
        width: '600px',
        height: '200px',
        rows: [
          ['A', 'B'],
          ['C', 'D'],
          ['E', 'F'],
        ],
      },
      {},
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const layout = (
      created.value as {
        layout: {
          mode: string;
          status: string;
          frameEmu: number;
          rowHeightsEmu: number[];
        };
      }
    ).layout;
    expect(layout.mode).toBe('fixed');
    expect(layout.status).toBe('complete');
    expect(layout.frameEmu).toBe(1_905_000);
    expect(layout.rowHeightsEmu.reduce((sum, height) => sum + height, 0)).toBe(1_905_000);
    const xml = await readFile(join(workspace, 'source/ppt/slides/slide1.xml'), 'utf8');
    expect(xml).toContain('cy="1905000"');
    const rowHeights = [...xml.matchAll(/<a:tr h="(\d+)"/g)].map((match) => Number(match[1]));
    expect(rowHeights.reduce((sum, height) => sum + height, 0)).toBe(1_905_000);

    const status = await pptxAdapter.execute(
      { version: '2.0', type: 'status', workspaceId: workspace },
      {},
    );
    const rev2 = status.ok ? String((status.value as { revision: string }).revision) : revision;
    const laid = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setTableLayout',
        workspaceId: workspace,
        transactionId: rev2,
        target: 'slide:1/shape:Sized',
        height: '200px',
        redistribute: 'content',
      },
      {},
    );
    expect(laid.ok).toBe(true);
    if (!laid.ok) return;
    const again = (
      laid.value as { layout: { status: string; frameEmu: number; rowHeightsEmu: number[] } }
    ).layout;
    expect(again.status).toBe('complete');
    expect(again.frameEmu).toBe(1_905_000);
    expect(again.rowHeightsEmu.reduce((sum, height) => sum + height, 0)).toBe(1_905_000);
  });

  it('duplicate batch reports changedParts covering presentation, notes, content types', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-changed-parts-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await writeArchive(source, (a) => {
      baseParts(a);
      a.setPart(
        '/ppt/slides/slide1.xml',
        e.encode(
          `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>One</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
        ),
        SLIDE_CT,
      );
      a.setRelationships('/ppt/slides/slide1.xml', [
        {
          id: 'rId1',
          type: REL.notes,
          target: '../notesSlides/notesSlide1.xml',
          external: false,
        },
      ]);
      a.setPart(
        '/ppt/notesSlides/notesSlide1.xml',
        e.encode(
          `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Note</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
        ),
        NOTES_CT,
      );
      a.setRelationships('/ppt/notesSlides/notesSlide1.xml', [
        {
          id: 'rId1',
          type: REL.slide,
          target: '../slides/slide1.xml',
          external: false,
        },
      ]);
    });

    await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );

    const batch = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'batch',
        workspaceId: workspace,
        transactionId: 'latest',
        atomic: true,
        commands: [
          {
            version: '2.0',
            type: 'duplicate',
            workspaceId: workspace,
            transactionId: 'latest',
            target: 'slide:1',
          },
        ],
      },
      {},
    );
    expect(batch.ok).toBe(true);
    if (batch.ok) {
      const parts = (batch.value as { changedParts: string[] }).changedParts;
      expect(parts).toEqual(expect.arrayContaining(['/ppt/presentation.xml']));
      expect(parts.some((p) => p.includes('presentation.xml.rels') || p.includes('_rels'))).toBe(
        true,
      );
      expect(parts.some((p) => p.startsWith('/ppt/slides/slide') && p.endsWith('.xml'))).toBe(true);
      expect(parts.some((p) => p.startsWith('/ppt/notesSlides/'))).toBe(true);
      expect(parts).toEqual(expect.arrayContaining(['/docProps/app.xml']));
      expect(parts).toEqual(expect.arrayContaining(['/[Content_Types].xml']));
    }
  });
});
