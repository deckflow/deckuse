#!/usr/bin/env node
// Native-refresh evidence can be added to this deterministic embedded-data fixture.
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { OpcArchive } from '../dist/opc/index.js';
import { NS, REL, descendants, children } from '../dist/pptx/xml.js';
import { verifyChartData } from '../dist/pptx/chart-data.js';
import { runCommand } from '../dist/index.js';
const output = resolve(process.argv[2] ?? '.tmp/visual-baseline');
const archive = await OpcArchive.openFile(join(output, 'charts.pptx'));
const book = new OpcArchive();
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const encode = (s) => new TextEncoder().encode(s);
book.setPart(
  '/xl/workbook.xml',
  encode(
    `<workbook xmlns="${S}" xmlns:r="${NS.r}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  ),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
);
book.setRelationships('/', [
  {
    id: 'rId1',
    type: REL.package.replace('/package', '/officeDocument'),
    target: 'xl/workbook.xml',
    external: false,
  },
]);
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
    `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Revenue</t></is></c><c r="B1"><v>42</v></c><c r="C1"><v>20</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Cost</t></is></c><c r="B2"><v>72</v></c><c r="C2"><v>30</v></c></row></sheetData></worksheet>`,
  ),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
);
archive.setPart(
  '/ppt/embeddings/fixture.xlsx',
  await book.toUint8Array(),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
);
const chart = archive.readXml('/ppt/charts/chart1.xml');
const el = (name, text) => {
  const n = chart.createElementNS(NS.c, 'c:' + name);
  if (text !== undefined) n.textContent = String(text);
  return n;
};
for (const [i, ser] of descendants(chart, 'ser').entries()) {
  const lit = descendants(ser, 'numLit')[0];
  const ref = el('numRef'),
    cache = el('numCache');
  ref.appendChild(el('f', `Sheet1!$${i ? 'C' : 'B'}$1:$${i ? 'C' : 'B'}$2`));
  for (const child of children(lit)) cache.appendChild(child.cloneNode(true));
  ref.appendChild(cache);
  lit.parentNode.replaceChild(ref, lit);
  const tx = descendants(ser, 'tx')[0];
  const value = descendants(tx, 'v')[0].textContent;
  for (const child of [...children(tx)]) tx.removeChild(child);
  const sr = el('strRef'),
    sc = el('strCache'),
    count = el('ptCount'),
    pt = el('pt');
  count.setAttribute('val', '1');
  pt.setAttribute('idx', '0');
  pt.appendChild(el('v', value));
  sc.appendChild(count);
  sc.appendChild(pt);
  sr.appendChild(el('f', `Sheet1!$A$${i + 1}`));
  sr.appendChild(sc);
  tx.appendChild(sr);
}
const ext = el('externalData');
ext.setAttributeNS(NS.r, 'r:id', 'rIdBook');
chart.documentElement.appendChild(ext);
archive.setRelationships('/ppt/charts/chart1.xml', [
  { id: 'rIdBook', type: REL.package, target: '../embeddings/fixture.xlsx', external: false },
]);
archive.writeXml('/ppt/charts/chart1.xml', chart);
const source = join(output, 'workbook-source.pptx');
await archive.writeFile(source, true);
const workspace = join(await mkdtemp(join(tmpdir(), 'deckuse-native-book-')), 'ws');
const run = async (op) => {
  const r = await runCommand({ version: '2.0', workspaceId: workspace, ...op });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r;
};
await run({ type: 'init', format: 'pptx', source });
const changes = await run({
  type: 'batch',
  transactionId: '1',
  commands: [
    {
      version: '2.0',
      workspaceId: workspace,
      type: 'duplicate',
      transactionId: '1',
      target: 'slide:1',
    },
    {
      version: '2.0',
      workspaceId: workspace,
      type: 'setProperties',
      transactionId: '1',
      target: 'slide:9/shape:column-colors-legend',
      properties: { series: [{ name: 'Updated revenue', values: [72, 96] }] },
    },
  ],
});
const exported = join(output, 'workbook-synced.pptx');
await run({ type: 'export', profile: 'delivery', output: exported });
const result = await OpcArchive.openFile(exported);
if (
  !result
    .getPart('/ppt/embeddings/fixture.xlsx')
    .data.every((v, i) => v === archive.getPart('/ppt/embeddings/fixture.xlsx').data[i])
)
  throw new Error('Original workbook changed');
const chartData = await verifyChartData(result);
if (chartData.some((c) => c.status === 'inconsistent' || c.status === 'unverified'))
  throw new Error(JSON.stringify(chartData));
await writeFile(
  join(output, 'workbook-evidence.json'),
  JSON.stringify(
    {
      inputSha256: createHash('sha256')
        .update(await readFile(exported))
        .digest('hex'),
      changes,
      chartData,
      originalWorkbookUnchanged: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ output: exported, chartData }));
