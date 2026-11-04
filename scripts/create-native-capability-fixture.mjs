#!/usr/bin/env node
import { createDefaultExecutor } from '../dist/index.js';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('..', import.meta.url)),
  output = resolve(process.argv[2] ?? '__temps__/native-capabilities.pptx'),
  root = await mkdtemp(join(tmpdir(), 'deckuse-native-fixture-')),
  workspaceId = join(root, 'ws'),
  ex = createDefaultExecutor();
let rev = '1';
async function run(input) {
  const result = await ex.execute({
    version: '2.0',
    workspaceId,
    ...(['init', 'export'].includes(input.type) ? {} : { transactionId: rev }),
    ...input,
  });
  if (!result.ok) throw Error(JSON.stringify(result));
  if (result.value?.revision) rev = String(result.value.revision);
  return result.value;
}
await run({
  type: 'init',
  format: 'pptx',
  source: join(repo, 'assets/default.pptx'),
  pageSize: { width: '10in', height: '7.5in' },
});
await run({ type: 'addSlide', name: 'Native capability acceptance' });
await run({
  type: 'set',
  target: 'slide:2',
  properties: {
    fill: {
      type: 'linearGradient',
      angle: 90,
      stops: [
        { position: 0, color: 'FFFFFF' },
        { position: 1, color: 'DDEEFF' },
      ],
    },
  },
});
for (const [name, x, y] of [
  ['Node A', '1in', '1in'],
  ['Node B', '3in', '1in'],
  ['Node C', '6in', '1in'],
])
  await run({
    type: 'addShape',
    slide: 2,
    shapeType: 'rounded-rect',
    name,
    text: name,
    x,
    y,
    width: '1.5in',
    height: '0.7in',
    fill: '4472C4',
  });
await run({
  type: 'groupShapes',
  slide: 2,
  targets: ['slide:2/shape:Node A', 'slide:2/shape:Node B'],
  name: 'Movable group',
});
await run({
  type: 'addShape',
  slide: 2,
  shapeType: 'elbow-connector',
  name: 'Attached line',
  start: { target: 'slide:2/shape:Node B', site: 3 },
  end: { target: 'slide:2/shape:Node C', site: 1 },
  stroke: { color: '990099', width: 2 },
});
await run({
  type: 'addShape',
  slide: 2,
  shapeType: 'path',
  name: 'Bezier wave',
  x: '1in',
  y: '2.2in',
  width: '3in',
  height: '1in',
  geometry: {
    viewBox: { width: 100, height: 100 },
    connectionPoints: [{ x: 100, y: 20, angle: 0 }],
    paths: [
      [
        { type: 'move', x: 0, y: 20 },
        { type: 'cubic', x1: 25, y1: 100, x2: 75, y2: -50, x: 100, y: 20 },
        { type: 'line', x: 100, y: 100 },
        { type: 'line', x: 0, y: 100 },
        { type: 'close' },
      ],
    ],
  },
  fill: {
    type: 'linearGradient',
    angle: 0,
    stops: [
      { position: 0, color: '990099' },
      { position: 1, color: '4472C4', transparency: 35 },
    ],
  },
});
await run({
  type: 'addShape',
  slide: 2,
  shapeType: 'connector',
  name: 'Wave connection',
  start: { target: 'slide:2/shape:Bezier wave', site: 0 },
  end: { target: 'slide:2/shape:Node C', site: 2 },
});
await run({
  type: 'addShape',
  slide: 2,
  shapeType: 'table',
  name: 'Merged matrix',
  x: '5in',
  y: '2.2in',
  width: '4in',
  rows: [
    ['Merged heading', ''],
    ['Short', 'Body'],
    ['Tall row', 'Details'],
  ],
  rowHeights: ['0.35in', '0.45in', '0.8in'],
});
await run({
  type: 'mergeTableCells',
  target: 'slide:2/shape:Merged matrix',
  from: '0:0',
  to: '0:1',
});
await run({
  type: 'addShape',
  slide: 2,
  shapeType: 'chart',
  name: 'Editable data',
  x: '1in',
  y: '4.2in',
  width: '7in',
  height: '2.7in',
  chartType: 'combo',
  embeddedWorkbook: true,
  data: {
    categories: ['Q1', 'Q2', 'Q3'],
    series: [
      { name: 'Volume', values: [10, 20, 30], color: '888888', chart: 'column' },
      { name: 'Rate', values: [0.1, 0.2, 0.3], color: '990099', chart: 'line', axis: 'secondary' },
    ],
  },
});
await mkdir(join(output, '..'), { recursive: true });
await run({ type: 'export', output });
await writeFile(
  output + '.acceptance.json',
  JSON.stringify(
    {
      workspaceId,
      output,
      checks: [
        'Canvas 10 × 7.5 inches',
        'Select and drag Movable group; Attached line must stay on Node B and Node C',
        'PowerPoint Edit Data opens XLSX with Q1–Q3 and both series',
        'Bezier wave has editable points and linear gradient',
        'Merged matrix first row merged; physical row heights differ',
      ],
    },
    null,
    2,
  ),
);
console.log(output);
console.log(workspaceId);
