import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { commandSchema } from '../../src/core/index.js';
import { OpcArchive } from '../../src/opc/index.js';
import { buildBlankArchive, docxAdapter } from '../../src/docx/index.js';

const encoder = new TextEncoder();

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14">
  <w:body>
    <w:p w14:paraId="AAAA0001">
      <w:r><w:rPr><w:b/></w:rPr><w:t>Hel</w:t></w:r>
      <w:proofErr w:type="spellStart"/>
      <w:r><w:t>lo</w:t></w:r>
      <w:proofErr w:type="spellEnd"/>
    </w:p>
    <w:p w14:paraId="AAAA0002">
      <w:r><w:rPr><w:b/></w:rPr><w:t>AB</w:t></w:r>
      <w:r><w:t>CD</w:t></w:r>
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
    </w:sectPr>
  </w:body>
</w:document>
`;

async function fixture(): Promise<{ workspace: string; source: string }> {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-docx-'));
  const source = join(root, 'input.docx');
  const archive = buildBlankArchive();
  archive.setPart(
    '/word/document.xml',
    encoder.encode(DOCUMENT),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  );
  archive.setPart('/custom/unknown.bin', encoder.encode('keep-me'));
  await archive.writeFile(source);
  return { workspace: join(root, 'ws'), source };
}

const base = (workspace: string, transactionId = '1') => ({
  version: '2.0' as const,
  workspaceId: workspace,
  transactionId,
});

describe('docx adapter', () => {
  it('keeps the PPTX list resource and accepts addParagraph', () => {
    expect(
      commandSchema.safeParse({
        version: '2.0',
        type: 'list',
        workspaceId: 'ws',
        resource: 'slides',
      }).success,
    ).toBe(true);
    expect(
      commandSchema.safeParse({
        ...base('ws'),
        type: 'addParagraph',
        text: 'Hello',
        name: 'Intro',
      }).success,
    ).toBe(true);
  });

  it('inits, lists, edits across runs, batches bookmarks, and preserves unknown parts', async () => {
    const { workspace, source } = await fixture();
    const created = await docxAdapter.init({
      version: '2.0',
      type: 'init',
      workspaceId: workspace,
      format: 'docx',
      source,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const listed = await docxAdapter.execute({
      version: '2.0',
      type: 'list',
      workspaceId: workspace,
      resource: 'paragraphs',
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const items = (listed.value as { items: { target: string; textPreview?: string }[] }).items;
    expect(items.map((item) => item.target)).toEqual(['body/p:1', 'body/p:2']);
    expect(items[0]?.textPreview).toBe('Hello');

    const got = await docxAdapter.execute({
      version: '2.0',
      type: 'get',
      workspaceId: workspace,
      target: 'para:AAAA0001',
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect((got.value as { text: string }).text).toBe('Hello');

    const searched = await docxAdapter.execute({
      version: '2.0',
      type: 'search',
      workspaceId: workspace,
      kind: 'text',
      query: 'AB',
    });
    expect(searched.ok).toBe(true);

    const rejected = await docxAdapter.execute({
      ...base(workspace),
      type: 'addShape',
      slide: 1,
      shapeType: 'rect',
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe('UNSUPPORTED_CAPABILITY');
    expect(rejected.error.hint).toContain('addParagraph');

    const replaced = await docxAdapter.execute({
      ...base(workspace),
      type: 'replaceText',
      find: 'ell',
      replace: 'XX',
    });
    expect(replaced.ok).toBe(true);
    const afterReplace = await readFile(join(workspace, 'source', 'word', 'document.xml'), 'utf8');
    expect(afterReplace).toContain('HXX');
    expect(afterReplace).toContain('>o<');
    expect(afterReplace).not.toContain('>Hel<');

    const styled = await docxAdapter.execute({
      ...base(workspace, '2'),
      type: 'replaceText',
      find: 'BC',
      replace: 'X',
    });
    expect(styled.ok).toBe(true);
    const afterStyle = await readFile(join(workspace, 'source', 'word', 'document.xml'), 'utf8');
    expect(afterStyle).toContain('>AX<');
    expect(afterStyle).toContain('>D<');
    expect(afterStyle).toContain('<w:b');

    const batched = await docxAdapter.execute({
      ...base(workspace, '3'),
      type: 'batch',
      commands: [
        {
          ...base(workspace, '3'),
          type: 'addParagraph',
          after: 'body/p:1',
          name: 'Intro',
          style: 'Heading1',
          text: 'Draft',
        },
        {
          ...base(workspace, '3'),
          type: 'setText',
          target: 'bookmark:Intro',
          value: 'Hello batch',
        },
      ],
    });
    expect(batched.ok).toBe(true);
    if (!batched.ok) return;
    const intro = await docxAdapter.execute({
      version: '2.0',
      type: 'get',
      workspaceId: workspace,
      target: 'bookmark:Intro',
    });
    expect(intro.ok).toBe(true);
    if (!intro.ok) return;
    expect((intro.value as { text: string }).text).toBe('Hello batch');
    expect(
      (intro.value as { properties: Record<string, { direct: string }> }).properties[
        'paragraph.style'
      ]?.direct,
    ).toBe('Heading1');

    const unknown = await readFile(join(workspace, 'source', 'custom', 'unknown.bin'), 'utf8');
    expect(unknown).toBe('keep-me');

    const table = await docxAdapter.execute({
      ...base(workspace, '4'),
      type: 'addTable',
      name: 'FinTable',
      rows: [
        ['A', 'B'],
        ['1', '2'],
      ],
    });
    expect(table.ok).toBe(true);
    const tables = await docxAdapter.execute({
      version: '2.0',
      type: 'list',
      workspaceId: workspace,
      resource: 'tables',
    });
    expect(tables.ok).toBe(true);
    if (!tables.ok) return;
    expect((tables.value as { items: unknown[] }).items).toHaveLength(1);
    const cell = await docxAdapter.execute({
      version: '2.0',
      type: 'getText',
      workspaceId: workspace,
      ref: { documentId: workspace, path: 'body/table:1/row:1/cell:1/p:1' },
    });
    expect(cell.ok).toBe(true);
    if (!cell.ok) return;
    expect((cell.value as { text: string }).text).toBe('A');

    const broken = await docxAdapter.execute({
      ...base(workspace, '5'),
      type: 'insertBreak',
      kind: 'page',
      after: 'body/p:1',
    });
    expect(broken.ok).toBe(true);
    const xml = await readFile(join(workspace, 'source', 'word', 'document.xml'), 'utf8');
    expect(xml).toContain('w:type="page"');

    const exported = await docxAdapter.execute({
      version: '2.0',
      type: 'export',
      workspaceId: workspace,
      output: join(workspace, 'out.docx'),
    });
    expect(exported.ok).toBe(true);
    const packed = await OpcArchive.openFile(join(workspace, 'out.docx'));
    expect(packed.getPart('/custom/unknown.bin')?.data).toBeDefined();
    expect(new TextDecoder().decode(packed.getPart('/word/document.xml')?.data)).toContain(
      'Hello batch',
    );

    const undone = await docxAdapter.execute({
      version: '2.0',
      type: 'undo',
      workspaceId: workspace,
      steps: 1,
    });
    expect(undone.ok).toBe(true);
    const afterUndo = await readFile(join(workspace, 'source', 'word', 'document.xml'), 'utf8');
    expect(afterUndo).not.toContain('w:type="page"');
  });

  it('refuses to rewrite content controls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-docx-sdt-'));
    const source = join(root, 'input.docx');
    const archive = buildBlankArchive();
    archive.setPart(
      '/word/document.xml',
      encoder.encode(
        `<?xml version="1.0" encoding="UTF-8"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p><w:sdt><w:sdtContent><w:r><w:t>Locked</w:t></w:r></w:sdtContent></w:sdt></w:p>
            <w:sectPr/>
          </w:body>
        </w:document>`,
      ),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    );
    await archive.writeFile(source);
    const workspace = join(root, 'ws');
    const created = await docxAdapter.init({
      version: '2.0',
      type: 'init',
      workspaceId: workspace,
      format: 'docx',
      source,
    });
    expect(created.ok).toBe(true);
    const denied = await docxAdapter.execute({
      ...base(workspace),
      type: 'setText',
      target: 'body/p:1',
      value: 'Nope',
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.code).toBe('UNSUPPORTED_CAPABILITY');
  });

  it('validates, reopens package.docx, and read-backs IT markers after batch writes', async () => {
    const { workspace, source } = await fixture();
    const created = await docxAdapter.init({
      version: '2.0',
      type: 'init',
      workspaceId: workspace,
      format: 'docx',
      source,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const marker = 'IT-docx';
    const batched = await docxAdapter.execute({
      ...base(workspace),
      type: 'batch',
      commands: [
        {
          ...base(workspace),
          type: 'addParagraph',
          name: `${marker}-intro`,
          style: 'Heading1',
          text: `${marker} heading`,
        },
        {
          ...base(workspace),
          type: 'addParagraph',
          name: `${marker}-body`,
          text: `${marker} body text`,
        },
        {
          ...base(workspace),
          type: 'addTable',
          name: `${marker}-table`,
          rows: [
            [`${marker}-A`, 'B'],
            ['1', '2'],
          ],
        },
        {
          ...base(workspace),
          type: 'setText',
          target: `bookmark:${marker}-body`,
          value: `${marker} body updated`,
        },
      ],
    });
    expect(batched, JSON.stringify(batched)).toMatchObject({ ok: true });

    const validated = await docxAdapter.execute({
      version: '2.0',
      type: 'validate',
      workspaceId: workspace,
    });
    expect(validated.ok).toBe(true);

    const intro = await docxAdapter.execute({
      version: '2.0',
      type: 'get',
      workspaceId: workspace,
      target: `bookmark:${marker}-intro`,
    });
    expect(intro.ok).toBe(true);
    if (!intro.ok) return;
    expect((intro.value as { text: string }).text).toBe(`${marker} heading`);

    const body = await docxAdapter.execute({
      version: '2.0',
      type: 'get',
      workspaceId: workspace,
      target: `bookmark:${marker}-body`,
    });
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect((body.value as { text: string }).text).toBe(`${marker} body updated`);

    const paragraphs = await docxAdapter.execute({
      version: '2.0',
      type: 'list',
      workspaceId: workspace,
      resource: 'paragraphs',
    });
    expect(paragraphs.ok).toBe(true);
    if (!paragraphs.ok) return;
    const previews = (
      paragraphs.value as { items: Array<{ textPreview?: string }> }
    ).items.map((item) => item.textPreview ?? '');
    expect(previews.some((text) => text.includes(marker))).toBe(true);

    const bookmarks = await docxAdapter.execute({
      version: '2.0',
      type: 'list',
      workspaceId: workspace,
      resource: 'bookmarks',
    });
    expect(bookmarks.ok).toBe(true);
    if (!bookmarks.ok) return;
    const names = (bookmarks.value as { items: Array<{ name?: string }> }).items.map(
      (item) => item.name ?? '',
    );
    expect(names).toEqual(expect.arrayContaining([`${marker}-intro`, `${marker}-body`]));

    const packed = await OpcArchive.openFile(join(workspace, 'package.docx'));
    expect(packed.getPart('/[Content_Types].xml')).toBeDefined();
    expect(packed.getPart('/word/document.xml')).toBeDefined();
    const docXml = new TextDecoder().decode(packed.getPart('/word/document.xml')!.data);
    expect(docXml).toContain(`${marker} heading`);
    expect(docXml).toContain(`${marker} body updated`);
    expect(docXml).toContain(`${marker}-A`);
  });
});
