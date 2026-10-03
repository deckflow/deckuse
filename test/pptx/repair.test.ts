import { access, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OpcArchive } from '../../src/opc/index.js';
import { pptxAdapter } from '../../src/pptx/index.js';
import { planNotesSlideRepairs } from '../../src/pptx/slides.js';
import { REL } from '../../src/pptx/xml.js';

const e = new TextEncoder();
const CT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const NOTES_CT = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';

const slideXml = (text: string): string =>
  `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

const notesXml = (text: string): string =>
  `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;

const notesRel = (file: string) => ({
  id: 'rId1',
  type: REL.notes,
  target: `../notesSlides/${file}`,
  external: false,
  resolvedTarget: `/ppt/notesSlides/${file}`,
});

const slideBackRel = (slide: string, resolvedTarget: string) => ({
  id: 'rId1',
  type: REL.slide,
  target: `../slides/${slide}`,
  external: false,
  resolvedTarget,
});

async function writeArchive(path: string, build: (a: OpcArchive) => void): Promise<void> {
  const a = new OpcArchive();
  build(a);
  await a.writeFile(path);
}

const oneSlide = (a: OpcArchive): void => {
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
      type: REL.slide,
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
  a.setPart('/ppt/slides/slide1.xml', e.encode(slideXml('One')), SLIDE_CT);
  a.setRelationships('/ppt/slides/slide1.xml', [notesRel('notesSlide1.xml')]);
  a.setPart('/ppt/notesSlides/notesSlide1.xml', e.encode(notesXml('Note')), NOTES_CT);
};

const initOne = async (back: 'ok' | 'missing' = 'ok') => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-repair-'));
  const source = join(root, 'source.pptx');
  const workspace = join(root, 'workspace');
  await writeArchive(source, (a) => {
    oneSlide(a);
    if (back === 'ok') {
      a.setRelationships('/ppt/notesSlides/notesSlide1.xml', [
        slideBackRel('slide1.xml', '/ppt/slides/slide1.xml'),
      ]);
    } else {
      a.setRelationships('/ppt/notesSlides/notesSlide1.xml', []);
    }
  });
  const init = await pptxAdapter.init(
    { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
    {},
  );
  expect(init.ok).toBe(true);
  return { root, workspace };
};

describe('planNotesSlideRepairs', () => {
  it('plans a fix when the unique owner has a missing back-pointer', () => {
    const a = new OpcArchive();
    oneSlide(a);
    a.setRelationships('/ppt/notesSlides/notesSlide1.xml', []);
    const planned = planNotesSlideRepairs(a);
    expect(planned.ambiguous).toEqual([]);
    expect(planned.fixes).toEqual([
      { notes: '/ppt/notesSlides/notesSlide1.xml', ownerSlide: '/ppt/slides/slide1.xml' },
    ]);
  });

  it('is a no-op when the back-pointer already matches the unique owner', () => {
    const a = new OpcArchive();
    oneSlide(a);
    a.setRelationships('/ppt/notesSlides/notesSlide1.xml', [
      slideBackRel('slide1.xml', '/ppt/slides/slide1.xml'),
    ]);
    const planned = planNotesSlideRepairs(a);
    expect(planned.fixes).toEqual([]);
    expect(planned.ambiguous).toEqual([]);
  });
});

describe('deckuse repair / status / export validation', () => {
  it('is a no-op on a healthy workspace and reports valid status/export', async () => {
    const { root, workspace } = await initOne('ok');
    const before = await pptxAdapter.execute(
      { version: '2.0', type: 'status', workspaceId: workspace },
      {},
    );
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const revision = String((before.value as { revision: string }).revision);
    expect((before.value as { valid: boolean }).valid).toBe(true);
    expect((before.value as { diagnostics: unknown[] }).diagnostics).toEqual([]);

    const repaired = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'repair',
        workspaceId: workspace,
        transactionId: 'latest',
      },
      {},
    );
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    expect(repaired.value).toMatchObject({
      repaired: [],
      valid: true,
      dryRun: false,
      revision,
    });

    const exported = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'export',
        workspaceId: workspace,
        output: join(root, 'ok.pptx'),
      },
      {},
    );
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect((exported.value as { valid: boolean }).valid).toBe(true);
    expect((exported.value as { diagnostics: unknown[] }).diagnostics).toEqual([]);
    await access(join(root, 'ok.pptx'));
  });

  it('repairs a missing notes back-pointer and keeps notes body text', async () => {
    const { workspace } = await initOne('missing');
    const validated = await pptxAdapter.execute(
      { version: '2.0', type: 'validate', workspaceId: workspace },
      {},
    );
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.diagnostics.some((d) => d.code === 'NOTES_SLIDE_MISMATCH')).toBe(true);
      expect(validated.error.hint).toMatch(/deckuse repair --workspace /);
    }

    const repaired = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'repair',
        workspaceId: workspace,
        transactionId: 'latest',
      },
      {},
    );
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    expect((repaired.value as { repaired: { ownerSlide: string }[] }).repaired).toEqual([
      {
        notes: '/ppt/notesSlides/notesSlide1.xml',
        ownerSlide: '/ppt/slides/slide1.xml',
      },
    ]);

    const pack = await OpcArchive.openDirectory(join(workspace, 'source'));
    const back = pack
      .getRelationships('/ppt/notesSlides/notesSlide1.xml')
      .find((rel) => rel.type === REL.slide);
    expect(back?.resolvedTarget).toBe('/ppt/slides/slide1.xml');
    expect(
      await readFile(join(workspace, 'source/ppt/notesSlides/notesSlide1.xml'), 'utf8'),
    ).toContain('Note');

    const setNote = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setText',
        workspaceId: workspace,
        transactionId: String((repaired.value as { revision: string }).revision),
        target: 'slide:1/notes',
        text: 'After repair',
      },
      {},
    );
    expect(setNote.ok).toBe(true);
  });

  it('undo after repair restores the committed mismatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-repair-undo-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await writeArchive(source, (a) => {
      a.setPart(
        '/ppt/presentation.xml',
        e.encode(
          `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
        ),
        CT,
      );
      a.setRelationships('/ppt/presentation.xml', [
        {
          id: 'rId1',
          type: REL.slide,
          target: 'slides/slide1.xml',
          external: false,
        },
        {
          id: 'rId2',
          type: REL.slide,
          target: 'slides/slide2.xml',
          external: false,
        },
      ]);
      a.setPart(
        '/docProps/app.xml',
        e.encode(
          `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>2</Slides><Notes>2</Notes></Properties>`,
        ),
        'application/vnd.openxmlformats-officedocument.extended-properties+xml',
      );
      a.setPart('/ppt/slides/slide1.xml', e.encode(slideXml('One')), SLIDE_CT);
      a.setRelationships('/ppt/slides/slide1.xml', [notesRel('notesSlide1.xml')]);
      a.setPart('/ppt/notesSlides/notesSlide1.xml', e.encode(notesXml('N1')), NOTES_CT);
      a.setRelationships('/ppt/notesSlides/notesSlide1.xml', [
        slideBackRel('slide1.xml', '/ppt/slides/slide1.xml'),
      ]);
      a.setPart('/ppt/slides/slide2.xml', e.encode(slideXml('Two')), SLIDE_CT);
      a.setRelationships('/ppt/slides/slide2.xml', [notesRel('notesSlide2.xml')]);
      a.setPart('/ppt/notesSlides/notesSlide2.xml', e.encode(notesXml('N2')), NOTES_CT);
      a.setRelationships('/ppt/notesSlides/notesSlide2.xml', [
        slideBackRel('slide1.xml', '/ppt/slides/slide1.xml'),
      ]);
    });
    await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    expect(
      (await pptxAdapter.execute({ version: '2.0', type: 'validate', workspaceId: workspace }, {}))
        .ok,
    ).toBe(false);

    const repaired = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'repair',
        workspaceId: workspace,
        transactionId: 'latest',
      },
      {},
    );
    expect(repaired.ok).toBe(true);
    expect(
      (await pptxAdapter.execute({ version: '2.0', type: 'validate', workspaceId: workspace }, {}))
        .ok,
    ).toBe(true);

    const undone = await pptxAdapter.execute(
      { version: '2.0', type: 'undo', workspaceId: workspace, steps: 1 },
      {},
    );
    expect(undone.ok).toBe(true);
    const afterUndo = await pptxAdapter.execute(
      { version: '2.0', type: 'validate', workspaceId: workspace },
      {},
    );
    expect(afterUndo.ok).toBe(false);
    if (!afterUndo.ok) {
      expect(afterUndo.diagnostics.some((d) => d.code === 'NOTES_SLIDE_MISMATCH')).toBe(true);
    }
    const pack = await OpcArchive.openDirectory(join(workspace, 'source'));
    expect(
      pack
        .getRelationships('/ppt/notesSlides/notesSlide2.xml')
        .find((rel) => rel.type === REL.slide)?.resolvedTarget,
    ).toBe('/ppt/slides/slide1.xml');
  });
});
