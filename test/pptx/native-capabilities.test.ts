import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createDefaultExecutor } from '../../src/index.js';
import { assertDefaultPptxExists } from '../../src/default-template.js';
import { parseXml, OpcArchive } from '../../src/opc/index.js';
import { first, descendants } from '../../src/pptx/xml.js';
import { verifyChartData } from '../../src/pptx/chart-data.js';
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-native-')),
    workspaceId = join(root, 'ws'),
    executor = createDefaultExecutor();
  let revision = '1';
  const call = async (input: Record<string, unknown>) => {
    const base =
      input.type === 'export'
        ? { version: '2.0', workspaceId }
        : { version: '2.0', workspaceId, transactionId: revision };
    const result = await executor.execute({
      ...base,
      ...input,
      ...(Array.isArray(input.commands)
        ? { commands: input.commands.map((c) => ({ ...base, ...c })) }
        : {}),
    });

    if (result.ok && typeof result.value === 'object' && result.value && 'revision' in result.value)
      revision = String(result.value.revision);
    return result;
  };
  const init = await executor.execute({
    version: '2.0',
    type: 'init',
    workspaceId,
    format: 'pptx',
    source: await assertDefaultPptxExists(),
  });
  expect(init.ok).toBe(true);
  expect((await call({ type: 'addSlide', name: 'Native' })).ok).toBe(true);
  const xml = () => readFile(join(workspaceId, 'source/ppt/slides/slide2.xml'), 'utf8');
  return { root, workspaceId, executor, call, xml };
}
const shape = (name: string, x = 0) => ({
  type: 'addShape',
  slide: 2,
  shapeType: 'rect',
  name,
  x,
  y: 0,
  width: '1in',
  height: '1in',
});
it('groups existing siblings with stable child IDs, moves and ungroups atomically', async () => {
  const { call, xml } = await setup();
  expect((await call({ type: 'batch', commands: [shape('A'), shape('B', 1000000)] })).ok).toBe(
    true,
  );
  const before = await xml();
  const g = await call({
    type: 'groupShapes',
    slide: 2,
    targets: ['slide:2/shape:A', 'slide:2/shape:B'],
    name: 'G',
  });
  expect(g.ok, JSON.stringify(g)).toBe(true);
  expect(await xml()).toContain('<p:grpSp ');
  expect((await call({ type: 'xfrmSet', target: 'slide:2/shape:G', x: '1in' })).ok).toBe(true);
  expect((await call({ type: 'ungroupShapes', target: 'slide:2/shape:G' })).ok).toBe(true);
  expect(await xml()).toContain('name="A"');
  expect(await xml()).not.toBe(before);
  const baseline = await xml();
  const bad = await call({
    type: 'batch',
    commands: [
      shape('C'),
      { type: 'groupShapes', slide: 2, targets: ['slide:2/shape:A', 'slide:2/shape:C'] },
    ],
  });
  expect(bad.ok).toBe(false);
  expect(await xml()).toBe(baseline);
});
it('writes custom geometry and gradient, and connects nodes through moves/deletion', async () => {
  const { call, xml } = await setup();
  expect(
    (
      await call({
        type: 'batch',
        commands: [
          shape('A'),
          shape('B', 2000000),
          {
            type: 'addShape',
            slide: 2,
            shapeType: 'connector',
            name: 'C',
            start: { target: 'slide:2/shape:A', site: 3 },
            end: { target: 'slide:2/shape:B', site: 1 },
          },
        ],
      })
    ).ok,
  ).toBe(true);
  const before = await xml();
  expect(before).toContain('a:stCxn');
  expect((await call({ type: 'xfrmSet', target: 'slide:2/shape:B', x: '5in' })).ok).toBe(true);
  expect(await xml()).not.toBe(before);
  const connector = first(parseXml(await xml()), 'cxnSp');
  expect(first(first(connector!, 'xfrm')!, 'ext')?.getAttribute('cx')).toBe('3657600');
  const path = await call({
    type: 'addShape',
    slide: 2,
    shapeType: 'path',
    name: 'Wave',
    geometry: {
      viewBox: { width: 100, height: 100 },
      paths: [
        [
          { type: 'move', x: 0, y: 0 },
          { type: 'cubic', x1: 20, y1: 80, x2: 80, y2: 20, x: 100, y: 100 },
          { type: 'close' },
        ],
      ],
    },
    fill: {
      type: 'linearGradient',
      angle: 45,
      stops: [
        { position: 0, color: 'FF0000' },
        { position: 1, color: '0000FF', transparency: 50 },
      ],
    },
  });
  expect(path.ok, JSON.stringify(path)).toBe(true);
  expect(await xml()).toContain('a:custGeom');
  expect(await xml()).toContain('a:gradFill');
  expect((await call({ type: 'remove', target: 'slide:2/shape:B' })).ok).toBe(true);
  expect(await xml()).not.toContain('a:endCxn');
});
it('creates a real workbook and synchronizes values and categories', async () => {
  const { call, executor, workspaceId, root } = await setup();
  const result = await call({
    type: 'addShape',
    slide: 2,
    shapeType: 'chart',
    name: 'Chart',
    chartType: 'column',
    embeddedWorkbook: true,
    data: { categories: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const preflight = await executor.execute({
    version: '2.0',
    type: 'preflightChartData',
    workspaceId,
    target: 'slide:2/shape:Chart',
    properties: { series: [{ values: [3, 4] }], categories: ['X', 'Y'] },
  });
  expect(preflight.ok, JSON.stringify(preflight)).toBe(true);
  expect(preflight.ok && preflight.value).toMatchObject({ supported: true });
  const update = await call({
    type: 'set',
    target: 'slide:2/shape:Chart',
    properties: { series: [{ values: [3, 4] }], categories: ['X', 'Y'] },
  });
  expect(update.ok, JSON.stringify(update)).toBe(true);
  const output = join(root, 'out.pptx');
  expect((await call({ type: 'export', output })).ok).toBe(true);
  const archive = await OpcArchive.openFile(output);
  expect(await verifyChartData(archive)).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: 'consistent' })]),
  );
  const part = [...archive.parts.keys()].find((p) => p.endsWith('.xlsx'));
  expect(part).toBeTruthy();
  const book = await OpcArchive.open(archive.getPart(part!)!.data);
  expect(
    descendants(book.readXml('/xl/worksheets/sheet1.xml'), 't').map((n) => n.textContent),
  ).toContain('X');
});
it('merges and unmerges complete table regions, preserving rich content', async () => {
  const { call, xml, executor, workspaceId } = await setup();
  expect(
    (
      await call({
        type: 'addShape',
        slide: 2,
        shapeType: 'table',
        name: 'T',
        rows: [
          ['A', 'B'],
          ['C', 'D'],
        ],
        rowHeights: ['0.5in', '1in'],
      })
    ).ok,
  ).toBe(true);
  const queried = await executor.execute({
    version: '2.0',
    type: 'get',
    workspaceId,
    target: 'slide:2/shape:T',
  });
  expect(queried.ok && queried.value).toMatchObject({
    properties: { rowHeights: { effective: [457200, 914400], unit: 'emu' } },
  });
  const before = await xml();
  expect(
    (await call({ type: 'mergeTableCells', target: 'slide:2/shape:T', from: '0:0', to: '1:1' })).ok,
  ).toBe(false);
  expect(await xml()).toBe(before);
  const merged = await call({
    type: 'mergeTableCells',
    target: 'slide:2/shape:T',
    from: '0:0',
    to: '1:1',
    content: 'append',
  });
  expect(merged.ok, JSON.stringify(merged)).toBe(true);
  expect(await xml()).toContain('gridSpan="2"');
  expect(
    (await call({ type: 'unmergeTableCells', target: 'slide:2/shape:T', from: '0:0', to: '1:1' }))
      .ok,
  ).toBe(true);
  expect(await xml()).not.toContain('gridSpan=');
});

it.each(['bar', 'column', 'line', 'pie', 'combo'])(
  'round-trips embedded data for %s',
  async (chartType) => {
    const { call, root } = await setup();
    const series =
      chartType === 'combo'
        ? [
            { name: 'L', values: [7, 8], chart: 'line', axis: 'secondary' },
            { name: 'B', values: [1, 2], chart: 'column' },
          ]
        : [{ name: 'S', values: [1, 2] }];
    const added = await call({
      type: 'addShape',
      slide: 2,
      shapeType: 'chart',
      chartType,
      embeddedWorkbook: true,
      data: { categories: ['X', 'Y'], series },
    });
    expect(added.ok, JSON.stringify(added)).toBe(true);
    const output = join(root, 'roundtrip.pptx');
    expect((await call({ type: 'export', output })).ok).toBe(true);
    const archive = await OpcArchive.openFile(output);
    expect(await verifyChartData(archive)).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'consistent' })]),
    );
  },
);
it('refuses invalid native edits with no earlier batch operations persisted', async () => {
  const { call, xml } = await setup();
  expect((await call(shape('A'))).ok).toBe(true);
  const baseline = await xml();
  for (const bad of [
    {
      type: 'addShape',
      slide: 2,
      shapeType: 'connector',
      start: { target: 'slide:2/shape:A', site: 99 },
    },
    { type: 'groupShapes', slide: 2, targets: ['slide:2/shape:A', 'slide:2/shape:Missing'] },
    {
      type: 'addShape',
      slide: 2,
      shapeType: 'path',
      geometry: { viewBox: { width: 10, height: 10 }, paths: [[{ type: 'line', x: 1, y: 1 }]] },
    },
    {
      type: 'addShape',
      slide: 2,
      shapeType: 'rect',
      fill: {
        type: 'linearGradient',
        angle: 0,
        stops: [
          { position: 1, color: 'FFFFFF' },
          { position: 0, color: '000000' },
        ],
      },
    },
  ]) {
    expect((await call({ type: 'batch', commands: [shape('Temp'), bad] })).ok).toBe(false);
    expect(await xml()).toBe(baseline);
  }
});

it('validates low-level table merge edits at commit while allowing complete atomic batches', async () => {
  const { call, xml } = await setup();
  expect(
    (await call({ type: 'addShape', slide: 2, shapeType: 'table', name: 'T', rows: [['A', '']] }))
      .ok,
  ).toBe(true);
  const baseline = await xml();
  const anchor = {
    type: 'set',
    target: 'slide:2/shape:T/cell:0:0',
    properties: { merge: { gridSpan: 2 } },
  };
  const invalid = await call(anchor);
  expect(invalid.ok).toBe(false);
  expect(await xml()).toBe(baseline);
  const complete = await call({
    type: 'batch',
    commands: [
      anchor,
      { type: 'set', target: 'slide:2/shape:T/cell:0:1', properties: { merge: { hMerge: true } } },
    ],
  });
  expect(complete.ok, JSON.stringify(complete)).toBe(true);
  expect(await xml()).toContain('gridSpan="2"');
});

it('preflights formula blockers structurally and rolls back earlier batch writes', async () => {
  const { call, executor, root } = await setup();
  expect(
    (
      await call({
        type: 'addShape',
        slide: 2,
        shapeType: 'chart',
        name: 'Chart',
        chartType: 'column',
        embeddedWorkbook: true,
        data: { categories: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
      })
    ).ok,
  ).toBe(true);
  const source = join(root, 'formula.pptx');
  expect((await call({ type: 'export', output: source })).ok).toBe(true);
  const archive = await OpcArchive.openFile(source),
    embedded = [...archive.parts.keys()].find((p) => p.endsWith('.xlsx'))!;
  const book = await OpcArchive.open(archive.getPart(embedded)!.data),
    doc = book.readXml('/xl/worksheets/sheet1.xml'),
    S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const cell = doc.createElementNS(S, 'c');
  cell.setAttribute('r', 'C1');
  const f = doc.createElementNS(S, 'f');
  f.textContent = 'B2*2';
  cell.appendChild(f);
  const v = doc.createElementNS(S, 'v');
  v.textContent = '2';
  cell.appendChild(v);
  first(doc, 'row')!.appendChild(cell);
  book.writeXml('/xl/worksheets/sheet1.xml', doc);
  archive.setPart(embedded, await book.toUint8Array(), archive.getPart(embedded)!.mediaType);
  await archive.writeFile(source, true);
  const workspaceId = join(root, 'formula-ws');
  expect(
    (await executor.execute({ version: '2.0', type: 'init', workspaceId, format: 'pptx', source }))
      .ok,
  ).toBe(true);
  const preflight = await executor.execute({
    version: '2.0',
    type: 'preflightChartData',
    workspaceId,
    target: 'slide:2/shape:Chart',
    properties: { series: [{ values: [3, 4] }] },
  });
  expect(preflight.ok && preflight.value).toMatchObject({
    supported: false,
    revision: '1',
    blockers: [
      {
        code: 'WORKBOOK_FORMULA_DEPENDENCY',
        details: {
          cell: { sheet: 'Data', address: 'B2' },
          dependentCell: { sheet: 'Data', address: 'C1' },
        },
      },
    ],
  });
  const path = join(workspaceId, 'source/ppt/slides/slide2.xml'),
    before = await readFile(path, 'utf8'),
    base = { version: '2.0', workspaceId, transactionId: '1' };
  const rejected = await executor.execute({
    ...base,
    type: 'batch',
    commands: [
      { ...base, ...shape('Must roll back') },
      {
        ...base,
        type: 'set',
        target: 'slide:2/shape:Chart',
        properties: { series: [{ values: [3, 4] }] },
      },
    ],
  });
  expect(rejected.ok).toBe(false);
  expect(await readFile(path, 'utf8')).toBe(before);
  const allowed = await executor.execute({
    version: '2.0',
    type: 'preflightChartData',
    workspaceId,
    target: 'slide:2/shape:Chart',
    properties: { categories: ['X', 'Y'] },
  });
  expect(allowed.ok && allowed.value).toMatchObject({ supported: true });
});

it('flattens rotated groups exactly and refuses unrepresentable shear', async () => {
  const { call, xml } = await setup();
  expect((await call({ type: 'batch', commands: [shape('A'), shape('B', 1000000)] })).ok).toBe(
    true,
  );
  expect(
    (
      await call({
        type: 'groupShapes',
        slide: 2,
        targets: ['slide:2/shape:A', 'slide:2/shape:B'],
        name: 'G',
      })
    ).ok,
  ).toBe(true);
  expect((await call({ type: 'xfrmSet', target: 'slide:2/shape:G', rotation: 90 })).ok).toBe(true);
  const result = await call({ type: 'ungroupShapes', target: 'slide:2/shape:G' });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const doc = parseXml(await xml()),
    nodes = descendants(doc, 'sp');
  const a = nodes.find((n) => first(n, 'cNvPr')?.getAttribute('name') === 'A')!,
    b = nodes.find((n) => first(n, 'cNvPr')?.getAttribute('name') === 'B')!;
  expect(first(first(a, 'xfrm')!, 'off')?.getAttribute('x')).toBe('500000');
  expect(first(first(a, 'xfrm')!, 'off')?.getAttribute('y')).toBe('-500000');
  expect(first(first(b, 'xfrm')!, 'off')?.getAttribute('y')).toBe('500000');
  expect(first(a, 'xfrm')?.getAttribute('rot')).toBe('5400000');
  expect((await call({ type: 'xfrmSet', target: 'slide:2/shape:A', rotation: 45 })).ok).toBe(true);
  expect(
    (
      await call({
        type: 'groupShapes',
        slide: 2,
        targets: ['slide:2/shape:A', 'slide:2/shape:B'],
        name: 'Shear',
      })
    ).ok,
  ).toBe(true);
  expect((await call({ type: 'xfrmSet', target: 'slide:2/shape:Shear', width: '4in' })).ok).toBe(
    true,
  );
  const baseline = await xml();
  expect((await call({ type: 'ungroupShapes', target: 'slide:2/shape:Shear' })).ok).toBe(false);
  expect(await xml()).toBe(baseline);
});
it('rejects deletion of nodes with attached connectors when explicitly requested', async () => {
  const { call, xml } = await setup();
  expect(
    (
      await call({
        type: 'batch',
        commands: [
          shape('A'),
          shape('B', 2000000),
          {
            type: 'addShape',
            slide: 2,
            shapeType: 'connector',
            start: { target: 'slide:2/shape:A', site: 3 },
            end: { target: 'slide:2/shape:B', site: 1 },
          },
        ],
      })
    ).ok,
  ).toBe(true);
  const baseline = await xml();
  const result = await call({ type: 'remove', target: 'slide:2/shape:B', connections: 'reject' });
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'CONNECTOR_NODE_IN_USE' })]),
  );
  expect(await xml()).toBe(baseline);
});
