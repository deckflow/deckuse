import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpcArchive } from '../../src/opc/index.js';
import { updateChart } from '../../src/pptx/elements.js';
import { verifyChartData } from '../../src/pptx/chart-data.js';
import { NS, REL, descendants } from '../../src/pptx/xml.js';
import { pptxAdapter } from '../../src/pptx/adapter.js';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const encode = (text: string) => new TextEncoder().encode(text);
export async function workbookFixture() {
  const a = new OpcArchive();
  const book = new OpcArchive();
  book.setPart(
    '/xl/workbook.xml',
    encode(
      `<workbook xmlns="${S}" xmlns:r="${NS.r}"><sheets><sheet name="Data Set" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
  );
  book.setRelationships('/xl/workbook.xml', [
    {
      id: 'rId1',
      type: REL.package.replace('/package', '/worksheet'),
      target: 'worksheets/sheet1.xml',
      external: false,
    },
  ]);
  book.setPart(
    '/xl/worksheets/sheet1.xml',
    encode(
      `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c><c r="C1" t="s"><v>0</v></c></row><row r="2"><c r="B2"><v>69</v></c></row></sheetData></worksheet>`,
    ),
  );
  book.setPart(
    '/xl/sharedStrings.xml',
    encode(`<sst xmlns="${S}" count="2" uniqueCount="1"><si><t>Revenue</t></si></sst>`),
  );
  book.setPart('/custom/untouched.bin', encode('keep'));
  a.setPart(
    '/ppt/embeddings/data.xlsx',
    await book.toUint8Array(),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const cache = (nums: number[]) =>
    `<c:ptCount val="${nums.length}"/>${nums.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}`;
  a.setPart(
    '/ppt/charts/chart1.xml',
    encode(
      `<c:chartSpace xmlns:c="${NS.c}" xmlns:r="${NS.r}"><c:chart><c:plotArea><c:barChart><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>'Data Set'!$A$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef></c:tx><c:val><c:numRef><c:f>'Data Set'!$B$1:$B$2</c:f><c:numCache>${cache([42, 69])}</c:numCache></c:numRef></c:val></c:ser><c:ser><c:idx val="1"/><c:order val="1"/><c:tx><c:v>Mirror</c:v></c:tx><c:val><c:numRef><c:f>'Data Set'!$B$1:$B$2</c:f><c:numCache>${cache([42, 69])}</c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart><c:externalData r:id="rId1"/></c:chartSpace>`,
    ),
    'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
  );
  a.setRelationships('/ppt/charts/chart1.xml', [
    { id: 'rId1', type: REL.package, target: '../embeddings/data.xlsx', external: false },
  ]);
  for (const n of [1, 2]) {
    a.setPart(
      `/ppt/slides/slide${n}.xml`,
      encode(
        `<p:sld xmlns:p="${NS.p}" xmlns:c="${NS.c}" xmlns:r="${NS.r}" xmlns:a="${NS.a}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/></p:nvGrpSpPr><p:grpSpPr/><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Chart"/></p:nvGraphicFramePr><p:xfrm><a:off x="100" y="100"/><a:ext cx="1000" cy="1000"/></p:xfrm><a:graphic><a:graphicData><c:chart r:id="rId1"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
      ),
    );
    a.setRelationships(`/ppt/slides/slide${n}.xml`, [
      { id: 'rId1', type: REL.chart, target: '../charts/chart1.xml', external: false },
    ]);
  }
  a.setPart(
    '/ppt/presentation.xml',
    encode(
      `<p:presentation xmlns:p="${NS.p}" xmlns:r="${NS.r}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    ),
    'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  );
  a.setRelationships(
    '/ppt/presentation.xml',
    [1, 2].map((n) => ({
      id: `rId${n}`,
      type: REL.slide,
      target: `slides/slide${n}.xml`,
      external: false,
    })),
  );
  return OpcArchive.open(await a.toUint8Array());
}
describe('embedded chart workbooks', () => {
  it('isolates a shared chart and workbook, synchronizes all caches, preserves shared strings', async () => {
    const a = await workbookFixture();
    expect(await verifyChartData(a)).toMatchObject([{ status: 'consistent' }]);
    const originalChart = a.getPart('/ppt/charts/chart1.xml')!.data.slice();
    const originalBook = a.getPart('/ppt/embeddings/data.xlsx')!.data.slice();
    const doc = a.readXml('/ppt/slides/slide2.xml');
    const node = descendants(doc, 'graphicFrame')[0]!;
    const result = await updateChart(
      a,
      '/ppt/charts/chart1.xml',
      { series: [{ name: 'Profit', values: [72, 96] }] },
      { part: '/ppt/slides/slide2.xml', node },
    );
    a.writeXml('/ppt/slides/slide2.xml', doc);
    expect(result.isolation).toHaveLength(2);
    expect(a.getPart('/ppt/charts/chart1.xml')!.data).toEqual(originalChart);
    expect(a.getPart('/ppt/embeddings/data.xlsx')!.data).toEqual(originalBook);
    expect(await verifyChartData(a)).toMatchObject([
      { status: 'consistent' },
      { status: 'consistent' },
    ]);
    const book = await OpcArchive.open(a.getPart(result.changes[0]!.workbook)!.data);
    const sheet = book.readXml('/xl/worksheets/sheet1.xml');
    expect(
      descendants(sheet, 'c')
        .find((c) => c.getAttribute('r') === 'C1')!
        .getAttribute('t'),
    ).toBe('s');
    expect(
      descendants(
        descendants(sheet, 'c').find((c) => c.getAttribute('r') === 'A1')!,
        't',
      )[0]!.textContent,
    ).toBe('Profit');
    expect(book.getPart('/custom/untouched.bin')!.data).toEqual(encode('keep'));
    expect(
      descendants(a.readXml(result.chartPart), 'numCache').map((c) =>
        descendants(c, 'v').map((v) => v.textContent),
      ),
    ).toEqual([
      ['72', '96'],
      ['72', '96'],
    ]);
  });
  it('detects drift and refuses formulas, resizing and conflicting shared-cell writes', async () => {
    const a = await workbookFixture();
    const chart = a.readXml('/ppt/charts/chart1.xml');
    descendants(chart, 'numCache')[0]!.getElementsByTagName('c:v')[0]!.textContent = '999';
    a.writeXml('/ppt/charts/chart1.xml', chart);
    expect(await verifyChartData(a)).toMatchObject([{ status: 'inconsistent' }]);
    await expect(
      updateChart(a, '/ppt/charts/chart1.xml', { series: [{ values: [1] }] }),
    ).rejects.toThrow('resizing');
    await expect(
      updateChart(a, '/ppt/charts/chart1.xml', {
        series: [{ values: [1, 2] }, { values: [3, 4] }],
      }),
    ).rejects.toThrow('Conflicting');
    const book = await OpcArchive.open(a.getPart('/ppt/embeddings/data.xlsx')!.data);
    const doc = book.readXml('/xl/worksheets/sheet1.xml');
    const f = doc.createElementNS(S, 'f');
    f.textContent = 'SUM(B1:B2)';
    descendants(doc, 'c')[1]!.appendChild(f);
    book.writeXml('/xl/worksheets/sheet1.xml', doc);
    a.setPart('/ppt/embeddings/data.xlsx', await book.toUint8Array());
    await expect(
      updateChart(a, '/ppt/charts/chart1.xml', { series: [{ values: [1, 2] }] }),
    ).rejects.toThrow('formula');
    expect(await verifyChartData(a)).toMatchObject([{ status: 'unverified' }]);
  });
  it('supports adapter dry-run, delivery, reopen, batch rollback and undo', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-chart-book-'));
    const a = await workbookFixture(),
      source = join(root, 'input.pptx'),
      workspace = join(root, 'ws');
    await a.writeFile(source);
    expect(
      (
        await pptxAdapter.init(
          { version: '2.0', type: 'init', format: 'pptx', workspaceId: workspace, source },
          {},
        )
      ).ok,
    ).toBe(true);
    const base = { version: '2.0' as const, workspaceId: workspace };
    const command = {
      ...base,
      type: 'setProperties' as const,
      transactionId: '1',
      target: 'slide:2/shape:2',
      properties: { series: [{ values: [72, 96] }] },
    };
    const original = await readFile(join(workspace, 'package.pptx'));
    const dry = await pptxAdapter.execute({ ...command, dryRun: true }, {});
    expect(dry.ok, JSON.stringify(dry)).toBe(true);
    expect(await readFile(join(workspace, 'package.pptx'))).toEqual(original);
    const failed = await pptxAdapter.execute(
      {
        ...base,
        type: 'batch',
        transactionId: '1',
        commands: [command, { ...command, target: 'slide:999/shape:2' }],
      },
      {},
    );
    expect(failed.ok).toBe(false);
    expect(await readFile(join(workspace, 'package.pptx'))).toEqual(original);
    expect((await pptxAdapter.execute(command, {})).ok).toBe(true);
    const verified = await pptxAdapter.execute(
      { ...base, type: 'validate', profile: 'delivery', level: 'full' },
      {},
    );
    expect(verified.ok, JSON.stringify(verified)).toBe(true);
    const output = join(root, 'out.pptx');
    expect(
      (await pptxAdapter.execute({ ...base, type: 'export', profile: 'delivery', output }, {})).ok,
    ).toBe(true);
    expect(
      (await verifyChartData(await OpcArchive.openFile(output))).every(
        (v) => v.status === 'consistent',
      ),
    ).toBe(true);
    expect((await pptxAdapter.execute({ ...base, type: 'undo', steps: 1 }, {})).ok).toBe(true);
    const restored = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    expect([...restored.parts.keys()].some((p) => p.includes('-copy'))).toBe(false);
    expect(await verifyChartData(restored)).toMatchObject([{ status: 'consistent' }]);
  });
  it('edits a duplicated slide twice in one batch without changing its source workbook', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-chart-duplicate-'));
    const a = await workbookFixture(),
      source = join(root, 'input.pptx'),
      workspace = join(root, 'ws');
    await a.writeFile(source);
    const originalBook = a.getPart('/ppt/embeddings/data.xlsx')!.data.slice();
    await pptxAdapter.init(
      { version: '2.0', type: 'init', format: 'pptx', workspaceId: workspace, source },
      {},
    );
    const base = { version: '2.0' as const, workspaceId: workspace, transactionId: '1' };
    const result = await pptxAdapter.execute(
      {
        ...base,
        type: 'batch',
        commands: [
          { ...base, type: 'duplicate', target: 'slide:1' },
          {
            ...base,
            type: 'setProperties',
            target: 'slide:3/shape:2',
            properties: { series: [{ values: [72, 96] }] },
          },
          {
            ...base,
            type: 'setProperties',
            target: 'slide:3/shape:2',
            properties: { series: [{ values: [73, 97] }] },
          },
        ],
      },
      {},
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const exported = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    expect(exported.getPart('/ppt/embeddings/data.xlsx')!.data).toEqual(originalBook);
    const slide = exported.readXml('/ppt/slides/slide3.xml');
    const id = descendants(slide, 'chart')[0]!.getAttributeNS(NS.r, 'id');
    const chart = exported
      .getRelationships('/ppt/slides/slide3.xml')
      .find((r) => r.id === id)!.resolvedTarget!;
    expect(
      descendants(exported.readXml(chart), 'numCache').map((c) =>
        descendants(c, 'v').map((v) => v.textContent),
      ),
    ).toEqual([
      ['73', '97'],
      ['73', '97'],
    ]);
    expect((await verifyChartData(exported)).every((c) => c.status === 'consistent')).toBe(true);
  });
  it('blocks a drifting package snapshot even when source is valid, preserving the destination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-chart-delivery-'));
    const archive = await workbookFixture(),
      source = join(root, 'input.pptx'),
      workspace = join(root, 'ws');
    await archive.writeFile(source);
    await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    const packagePath = join(workspace, 'package.pptx');
    const snapshot = await OpcArchive.openFile(packagePath);
    const chart = snapshot.readXml('/ppt/charts/chart1.xml');
    descendants(descendants(chart, 'numCache')[0]!, 'v')[0]!.textContent = '999';
    snapshot.writeXml('/ppt/charts/chart1.xml', chart);
    await snapshot.writeFile(packagePath, true);
    const output = join(root, 'delivery.pptx');
    await writeFile(output, 'keep-existing');
    const base = { version: '2.0' as const, workspaceId: workspace };
    expect(
      (
        await pptxAdapter.execute(
          { ...base, type: 'validate', level: 'full', profile: 'delivery' },
          {},
        )
      ).ok,
    ).toBe(true);
    const result = await pptxAdapter.execute(
      { ...base, type: 'export', profile: 'delivery', fromPackage: true, output },
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'CHART_DATA_INCONSISTENT')).toBe(true);
    expect(await readFile(output, 'utf8')).toBe('keep-existing');
    const staged = (await readdir(root)).filter((name) => name.endsWith('.tmp'));
    if (process.env.DECKUSE_CLEANUP_MODE === 'delete') {
      expect(staged).toEqual([]);
    } else {
      expect(staged).toHaveLength(1);
      expect(result).toMatchObject({
        error: { details: { cleanupWarning: expect.stringContaining(join(root, staged[0]!)) } },
      });
    }
  });
});
