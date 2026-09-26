import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OpcArchive } from '../../src/opc/index.js';
import { pptxAdapter } from '../../src/pptx/index.js';
import { resolveProperties } from '../../src/pptx/resolve-properties.js';

const e = new TextEncoder();
const CT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';

async function writeArchive(path: string, build: (a: OpcArchive) => void): Promise<void> {
  const a = new OpcArchive();
  build(a);
  await a.writeFile(path);
}

const twoCellTableXml = (
  cell0: string,
  cell1: string,
  opts?: { nested?: boolean; gridSpan?: boolean },
): string => {
  const nestedInner = opts?.nested
    ? `<a:tbl><a:tblGrid><a:gridCol w="500"/></a:tblGrid><a:tr h="50"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>NEST</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl>`
    : '';
  const secondCell = opts?.gridSpan
    ? `<a:tc gridSpan="1"><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1200"/><a:t>${cell1}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`
    : `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1200"/><a:t>${cell1}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
  return `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="1000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="2000000"/><a:gridCol w="2000000"/></a:tblGrid><a:tr h="500000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1200"/><a:t>${cell0}</a:t></a:r></a:p></a:txBody><a:tcPr/>${nestedInner}</a:tc>${secondCell}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`;
};

const minimalParts = (a: OpcArchive, slideXml: string): void => {
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
  a.setPart('/ppt/slides/slide1.xml', e.encode(slideXml), SLIDE_CT);
  a.setRelationships('/ppt/slides/slide1.xml', []);
  a.setPart(
    '/docProps/app.xml',
    e.encode(
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>1</Slides></Properties>`,
    ),
    'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  );
};

const runCli = (args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((done) => {
    const child = spawn(process.execPath, [resolve('dist/bin.js'), ...args], {
      cwd: resolve('.'),
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('close', (code) => done({ code, stdout, stderr }));
    child.stdin.end('');
  });

type PropMap = Record<string, { effective?: unknown; unit?: string }>;

describe('table cell style read/write', () => {
  it('writes font, border, padding and reads them back without touching the neighbor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-cell-style-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await writeArchive(source, (a) => minimalParts(a, twoCellTableXml('Left', 'Right')));
    await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );

    const styled = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'setProperties',
        workspaceId: workspace,
        transactionId: 'latest',
        target: 'slide:1/shape:3/cell:0:0',
        properties: {
          'font.size': 18,
          'font.family': 'Arial',
          'font.color': 'DC2626',
          'font.weight': 'bold',
          border: { color: '2563EB', width: 1.5 },
          'padding.left': 6,
          'padding.top': 4,
        },
      },
      {},
    );
    expect(styled.ok, JSON.stringify(styled)).toBe(true);

    const xml = await readFile(join(workspace, 'source/ppt/slides/slide1.xml'), 'utf8');
    expect(xml).toContain('sz="1800"');
    expect(xml).toContain('typeface="Arial"');
    expect(xml).toContain('val="DC2626"');
    expect(xml).toContain('b="1"');
    expect(xml).toContain('<a:lnL ');
    expect(xml).toContain('marL="76200"'); // 6pt
    expect(xml).toContain('marT="50800"'); // 4pt

    const got = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'get',
        workspaceId: workspace,
        target: 'slide:1/shape:3/cell:0:0',
        props: [
          'font.size',
          'font.family',
          'font.color',
          'font.weight',
          'line.color',
          'line.width',
          'padding.left',
          'padding.top',
          'padding.right',
          'padding.bottom',
        ],
      },
      {},
    );
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const props = (got.value as { properties: PropMap; warnings?: string[] }).properties;
    expect((got.value as { warnings?: string[] }).warnings ?? []).toEqual([]);
    expect(props['font.size']?.effective).toBe(18);
    expect(props['font.family']?.effective).toBe('Arial');
    expect(props['font.color']?.effective).toBe('#DC2626');
    expect(props['font.weight']?.effective).toBe('bold');
    expect(props['line.color']?.effective).toBe('#2563EB');
    expect(props['line.width']?.effective).toBe(1.5);
    expect(props['padding.left']?.effective).toBe(6);
    expect(props['padding.top']?.effective).toBe(4);
    expect(props['padding.right']?.effective).toBeNull();
    expect(props['padding.bottom']?.effective).toBeNull();

    const neighbor = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'get',
        workspaceId: workspace,
        target: 'slide:1/shape:3/cell:0:1',
        props: ['font.size', 'line.color', 'padding.left'],
      },
      {},
    );
    expect(neighbor.ok).toBe(true);
    if (!neighbor.ok) return;
    const nProps = (neighbor.value as { properties: PropMap }).properties;
    expect(nProps['font.size']?.effective).toBe(12);
    expect(nProps['line.color']?.effective).toBeNull();
    expect(nProps['padding.left']?.effective).toBeNull();
  });

  it('CLI get returns cell text and align without empty-properties warning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-cell-cli-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await writeArchive(source, (a) => minimalParts(a, twoCellTableXml('Hello', 'World')));
    expect((await runCli(['init', source, workspace, '--json'])).code).toBe(0);

    const set = await runCli([
      'set',
      'slide:1/shape:3/cell:0:0',
      '--workspace',
      workspace,
      '--paragraph.align',
      'left',
      '--json',
    ]);
    expect(set.code, set.stderr || set.stdout).toBe(0);

    const got = await runCli([
      'get',
      'slide:1/shape:3/cell:0:0',
      '--workspace',
      workspace,
      '--props',
      'text.value,paragraph.align',
      '--json',
    ]);
    expect(got.code, got.stderr || got.stdout).toBe(0);
    const body = JSON.parse(got.stdout) as {
      ok: boolean;
      warnings?: string[];
      data: { properties: PropMap };
    };
    expect(body.ok).toBe(true);
    expect(body.warnings ?? []).toEqual([]);
    expect(body.data.properties['text.value']?.effective).toBe('Hello');
    expect(body.data.properties['paragraph.align']?.effective).toBe('l');
  });

  it('direct-child tc indexing ignores nested tbl and respects gridSpan sibling cells', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-cell-nested-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await writeArchive(source, (a) =>
      minimalParts(a, twoCellTableXml('Outer', 'Span', { nested: true, gridSpan: true })),
    );
    await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );

    const cell0 = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'get',
        workspaceId: workspace,
        target: 'slide:1/shape:3/cell:0:0',
        props: ['text.value'],
      },
      {},
    );
    const cell1 = await pptxAdapter.execute(
      {
        version: '2.0',
        type: 'get',
        workspaceId: workspace,
        target: 'slide:1/shape:3/cell:0:1',
        props: ['text.value'],
      },
      {},
    );
    expect(cell0.ok).toBe(true);
    expect(cell1.ok).toBe(true);
    if (!cell0.ok || !cell1.ok) return;
    expect(
      (
        (cell0.value as { properties: PropMap }).properties['text.value']?.effective as string
      ).includes('Outer'),
    ).toBe(true);
    // Must not resolve to nested NEST as cell:0:1
    expect((cell1.value as { properties: PropMap }).properties['text.value']?.effective).toBe(
      'Span',
    );
  });

  it('missing tc node returns ELEMENT_NOT_FOUND not empty properties', async () => {
    const archive = new OpcArchive();
    archive.setPart(
      '/ppt/slides/slide1.xml',
      e.encode(
        `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="100"/></a:tblGrid></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
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

  it('insertRow overlapping a peer shape warns to use setTableLayout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-cell-overlap-'));
    const source = join(root, 'source.pptx');
    const workspace = join(root, 'workspace');
    await writeArchive(source, (a) => {
      minimalParts(
        a,
        `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="1000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="4000000"/></a:tblGrid><a:tr h="914400"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame><p:sp><p:nvSpPr><p:cNvPr id="6" name="AutoShape 6"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1800000"/><a:ext cx="4000000" cy="500000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Footer</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
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
        properties: { insertRow: { index: 1, cells: ['B'] } },
      },
      {},
    );
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const warnings = (inserted.value as { warnings?: string[] }).warnings ?? [];
    const diagnostics = inserted.diagnostics ?? [];
    const messages = [...warnings, ...diagnostics.map((d) => d.message)];
    expect(messages.some((m) => m.includes('setTableLayout'))).toBe(true);
    expect(
      diagnostics.some((d) => d.code === 'TABLE_OVERLAPS_SHAPE') ||
        messages.some((m) => m.includes('overlaps')),
    ).toBe(true);
  });
});
