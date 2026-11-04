import { OpcArchive } from '../opc/index.js';
import type { Element } from '@xmldom/xmldom';
import { NS, REL, first, descendants, children } from './xml.js';
import { requireDefined as need } from '../required.js';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const enc = new TextEncoder();
const esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const col = (n: number): string =>
  n ? col(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26)) : '';
export async function attachChartWorkbook(
  archive: OpcArchive,
  part: string,
  data: { categories: string[]; series: { name: string; values: number[] }[] },
) {
  const chartDoc = archive.readXml(part);
  data = {
    ...data,
    series: descendants(chartDoc, 'ser').map((s) => ({
      name: first(first(s, 'tx') ?? s, 'v')?.textContent ?? '',
      values: descendants(first(s, 'val') ?? s, 'v').map((v) => Number(v.textContent)),
    })),
  };
  if (
    !data.categories.length ||
    data.series.some(
      (s) =>
        s.values.length !== data.categories.length || s.values.some((v) => !Number.isFinite(v)),
    )
  )
    throw new Error(
      'Embedded workbook requires matching nonempty categories and finite series values',
    );
  const book = new OpcArchive();
  const set = (p: string, xml: string, ct = 'application/xml') => {
    book.setPart(p, enc.encode(xml), ct);
  };
  set(
    '/xl/workbook.xml',
    `<workbook xmlns="${S}" xmlns:r="${NS.r}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  );
  book.setRelationships('/', [
    { id: 'rId1', type: `${NS.r}/officeDocument`, target: 'xl/workbook.xml', external: false },
  ]);
  book.setRelationships('/xl/workbook.xml', [
    { id: 'rId1', type: `${NS.r}/worksheet`, target: 'worksheets/sheet1.xml', external: false },
  ]);
  const str = (r: string, v: string) =>
    `<c r="${r}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  let rows = `<row r="1">${str('A1', 'Category')}${data.series.map((s, i) => str(`${col(i + 2)}1`, s.name)).join('')}</row>`;
  rows += data.categories
    .map(
      (category, i) =>
        `<row r="${String(i + 2)}">${str(`A${String(i + 2)}`, category)}${data.series.map((s, j) => `<c r="${col(j + 2)}${String(i + 2)}"><v>${String(s.values[i])}</v></c>`).join('')}</row>`,
    )
    .join('');
  set(
    '/xl/worksheets/sheet1.xml',
    `<worksheet xmlns="${S}"><sheetData>${rows}</sheetData></worksheet>`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  );
  let n = 1;
  while (archive.hasPartIgnoreCase(`/ppt/embeddings/workbook${String(n)}.xlsx`)) n++;
  const embedded = `/ppt/embeddings/workbook${String(n)}.xlsx`;
  archive.setPart(
    embedded,
    await book.toUint8Array(),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const doc = archive.readXml(part),
    series = descendants(doc, 'ser');
  const ref = (host: Element, literal: Element, address: string, numeric: boolean) => {
    const r = doc.createElementNS(NS.c, numeric ? 'c:numRef' : 'c:strRef'),
      f = doc.createElementNS(NS.c, 'c:f');
    f.textContent = `Data!${address}`;
    r.appendChild(f);
    const cache = doc.createElementNS(NS.c, numeric ? 'c:numCache' : 'c:strCache');
    for (const node of [...children(literal)]) cache.appendChild(node);
    r.appendChild(cache);
    host.replaceChild(r, literal);
  };
  series.forEach((s, i) => {
    const tx = need(first(s, 'tx')),
      v = need(first(tx, 'v')),
      literal = doc.createElementNS(NS.c, 'c:strLit');
    const count = doc.createElementNS(NS.c, 'c:ptCount');
    count.setAttribute('val', '1');
    literal.appendChild(count);
    const point = doc.createElementNS(NS.c, 'c:pt');
    point.setAttribute('idx', '0');
    point.appendChild(v);
    literal.appendChild(point);
    tx.appendChild(literal);
    ref(tx, literal, `$${col(i + 2)}$1`, false);
    const cat = need(first(s, 'cat'));
    ref(cat, need(first(cat, 'strLit')), `$A$2:$A$${String(data.categories.length + 1)}`, false);
    const val = need(first(s, 'val'));
    ref(
      val,
      need(first(val, 'numLit')),
      `$${col(i + 2)}$2:$${col(i + 2)}$${String(data.categories.length + 1)}`,
      true,
    );
  });
  const rid = 'rIdWorkbook';
  archive.setRelationships(part, [
    ...archive.getRelationships(part),
    {
      id: rid,
      type: REL.package,
      target: `../embeddings/workbook${String(n)}.xlsx`,
      external: false,
    },
  ]);
  const external = doc.createElementNS(NS.c, 'c:externalData');
  external.setAttributeNS(NS.r, 'r:id', rid);
  const update = doc.createElementNS(NS.c, 'c:autoUpdate');
  update.setAttribute('val', '0');
  external.appendChild(update);
  need(doc.documentElement).appendChild(external);
  archive.writeXml(part, doc);
}
