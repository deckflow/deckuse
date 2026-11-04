import { assertIndependentFormulas, WorkbookDependencyError } from './formula-dependencies.js';
import type { Document, Element } from '@xmldom/xmldom';
import { posix } from 'node:path';
import { OpcArchive } from '../opc/index.js';
import { NS, REL, children, descendants, first } from './xml.js';

const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export class ChartDataError extends Error {
  readonly details: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.details = details ?? {
      reasonCode: /^WORKBOOK_[A-Z_]+/.exec(message)?.[0] ?? 'CHART_DATA_UNSAFE',
      reason: message,
    };
  }
}
const fail = (message: string, details?: Record<string, unknown>): never => {
  throw new ChartDataError(message, details);
};

export interface CellBinding {
  sheet: string;
  part: string;
  address: string;
  cell: Element;
  value: string;
  numeric: boolean;
}
interface Binding {
  ref: Element;
  cache: Element;
  cells: CellBinding[];
  numeric: boolean;
}
export interface ChartVerification {
  part: string;
  status: 'consistent' | 'inconsistent' | 'unverified' | 'notApplicable';
  reason?: string;
  workbook?: string;
}

const direct = (node: Element, name: string) =>
  children(node).find((n) => n.namespaceURI === node.namespaceURI && n.localName === name);
const column = (value: string) => {
  let n = 0;
  for (let i = 0; i < value.length; i++) n = n * 26 + value.charCodeAt(i) - 64;
  return n;
};
const letters = (n: number): string =>
  n > 0 ? letters(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26)) : '';
function range(formula: string): { sheet: string; addresses: string[] } {
  if (formula.includes('[') || formula.includes(']'))
    return fail('External workbook references are unsupported');
  const m =
    /^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]+)\$?([1-9]\d*)(?::\$?([A-Z]+)\$?([1-9]\d*))?$/.exec(
      formula.trim(),
    );
  if (!m) return fail(`Unsupported chart reference: ${formula}`);
  const sheet = (m[1] ?? m[2] ?? '').replaceAll("''", "'");
  const c1 = column(m[3] ?? ''),
    r1 = Number(m[4]),
    c2 = column(m[5] ?? m[3] ?? ''),
    r2 = Number(m[6] ?? m[4]);
  if (
    c2 < c1 ||
    r2 < r1 ||
    (c1 !== c2 && r1 !== r2) ||
    c2 > 16384 ||
    r2 > 1048576 ||
    (c2 - c1 + 1) * (r2 - r1 + 1) > 10000
  )
    return fail('Only bounded single-row or single-column chart ranges are supported');
  const addresses: string[] = [];
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) addresses.push(`${letters(c)}${String(r)}`);
  return { sheet, addresses };
}
function workbookPart(archive: OpcArchive, part: string, chart: Document): string {
  const external = first(chart, 'externalData');
  const id = external?.getAttributeNS(NS.r, 'id');
  const rels = archive.getRelationships(part).filter((r) => r.type === REL.package);
  const rel = id ? rels.find((r) => r.id === id) : rels.length === 1 ? rels[0] : undefined;
  if (!rel || rel.external || !rel.resolvedTarget?.endsWith('.xlsx'))
    return fail('Chart requires an unambiguous embedded .xlsx workbook');
  return rel.resolvedTarget;
}
function bindings(book: OpcArchive, chart: Document, documents: Map<string, Document>): Binding[] {
  const workbook = book.readXml('/xl/workbook.xml');
  if (descendants(chart, 'pivotSource').length) return fail('Pivot chart data is not supported');
  const metadataExtensions = new Map([
    [
      '{CE6537A1-D6FC-4F65-9D91-7224C49458BB}',
      ['http://schemas.microsoft.com/office/drawing/2012/chart', 'showLeaderLines'],
    ],
    [
      '{6F2FDCE9-48DA-4B69-8628-5D25D57E5C99}',
      ['http://schemas.microsoft.com/office/drawing/2007/8/2/chart', 'invertSolidFillFmt'],
    ],
    [
      '{C3380CC4-5D6E-409C-BE32-E72D297353CC}',
      ['http://schemas.microsoft.com/office/drawing/2014/chart', 'uniqueId'],
    ],
  ]);
  for (const ext of descendants(chart, 'ext')) {
    const allowed = metadataExtensions.get((ext.getAttribute('uri') ?? '').toUpperCase());
    if (
      !allowed ||
      children(ext).length !== 1 ||
      children(ext).some((n) => n.namespaceURI !== allowed[0] || n.localName !== allowed[1])
    )
      return fail('Unrecognized chart data extension');
  }
  const shared = book.getPart('/xl/sharedStrings.xml')
    ? descendants(book.readXml('/xl/sharedStrings.xml'), 'si').map((si) =>
        descendants(si, 't')
          .map((t) => t.textContent ?? '')
          .join(''),
      )
    : [];
  return descendants(chart)
    .filter(
      (n) => n.namespaceURI === NS.c && (n.localName === 'numRef' || n.localName === 'strRef'),
    )
    .map((ref) => {
      const numeric = ref.localName === 'numRef';
      const formula = direct(ref, 'f')?.textContent ?? '';
      const parsed = range(formula);
      const sheet = descendants(workbook, 'sheet').find(
        (n) => n.getAttribute('name') === parsed.sheet,
      );
      const rid = sheet?.getAttributeNS(NS.r, 'id');
      const rel = book
        .getRelationships('/xl/workbook.xml')
        .find((r) => r.id === rid && r.type.endsWith('/worksheet') && !r.external);
      if (!rel?.resolvedTarget) return fail(`Worksheet not found: ${parsed.sheet}`);
      const sheetPart = rel.resolvedTarget;
      let doc = documents.get(sheetPart);
      if (!doc) {
        doc = book.readXml(sheetPart);
        documents.set(sheetPart, doc);
      }
      const cache = direct(ref, numeric ? 'numCache' : 'strCache');
      if (!cache) return fail('Chart reference cache is missing');
      const cells = parsed.addresses.map((address) => {
        const cell = descendants(doc, 'c').find(
          (n) => n.namespaceURI === S && n.getAttribute('r') === address,
        );
        if (!cell || direct(cell, 'f'))
          return fail(`Missing or formula cell: ${parsed.sheet}!${address}`, {
            reasonCode: cell ? 'WORKBOOK_FORMULA_TARGET' : 'WORKBOOK_CELL_MISSING',
            cell: { sheet: parsed.sheet, address },
          });
        const type = cell.getAttribute('t');
        let value = direct(cell, 'v')?.textContent ?? '';
        if (type === 's') {
          const index = Number(value);
          if (!/^\d+$/.test(value) || shared[index] === undefined)
            return fail('Invalid shared string index');
          value = shared[index] ?? '';
        } else if (type === 'inlineStr')
          value = descendants(cell, 't')
            .map((t) => t.textContent ?? '')
            .join('');
        else if (!['n', 'str', '', null].includes(type))
          return fail(`Unsupported cell type: ${String(type)}`);
        if (
          numeric &&
          (value.trim() === '' ||
            !Number.isFinite(Number(value)) ||
            !['n', '', null].includes(type))
        )
          return fail('Chart numeric references must address numeric constants');
        return { sheet: parsed.sheet, part: sheetPart, address, cell, value, numeric };
      });
      return { ref, cache, cells, numeric };
    });
}
const refs = (archive: OpcArchive, target: string) =>
  [...archive.relationships.values()]
    .flat()
    .filter((r) => !r.external && r.resolvedTarget === target).length;
function fresh(archive: OpcArchive, original: string): string {
  const ext = posix.extname(original),
    base = original.slice(0, -ext.length);
  for (let n = 1; ; n++) {
    const part = `${base}-copy${String(n)}${ext}`;
    if (!archive.hasPartIgnoreCase(part)) return part;
  }
}
export interface ChartOwner {
  part: string;
  node: Element;
}
export interface ChartChange {
  workbook: string;
  sheet: string;
  address: string;
  before: string;
  after: string;
}
export interface ChartUpdate {
  workbook: boolean;
  chartPart: string;
  changes: ChartChange[];
  isolation: { from: string; to: string }[];
}
export async function prepareChartData(
  archive: OpcArchive,
  part: string,
  chart: Document,
  properties: Record<string, unknown>,
) {
  const specifications = properties['series'];
  const series = descendants(chart, 'ser');
  const edits: { ref: Element; values: (string | number)[] }[] = [];
  if (Array.isArray(specifications))
    for (const [i, input] of (specifications as unknown[]).entries()) {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        return fail('Invalid chart series');
      const spec = input as Record<string, unknown>;
      const node = series[i];
      if (!node) return fail('Chart series index out of range');
      if (spec['values'] !== undefined) {
        if (
          !Array.isArray(spec['values']) ||
          !spec['values'].length ||
          !spec['values'].every((v: unknown) => typeof v === 'number' && Number.isFinite(v))
        )
          return fail('Chart values must be finite numbers');
        const val = direct(node, 'val');
        const ref = val && direct(val, 'numRef');
        if (ref) edits.push({ ref, values: spec['values'] as number[] });
        else if (!val || !direct(val, 'numLit'))
          return fail('Chart value cache is missing or unsupported');
      }
      if (spec['name'] !== undefined) {
        if (typeof spec['name'] !== 'string') return fail('Chart series name must be text');
        const tx = direct(node, 'tx');
        if (!tx) return fail('Chart series text is missing');
        const ref = direct(tx, 'strRef');
        if (ref) edits.push({ ref, values: [spec['name']] });
      }
    }
  if (typeof properties['title'] === 'string') {
    const title = first(chart, 'title'),
      ref = title && first(title, 'strRef');
    if (ref) edits.push({ ref, values: [properties['title']] });
  }
  if (properties['categories'] !== undefined) {
    const categories = properties['categories'];
    if (
      !Array.isArray(categories) ||
      !categories.length ||
      !categories.every((v) => typeof v === 'string')
    )
      return fail('Categories must be nonempty text array');
    for (const s of series) {
      const cat = direct(s, 'cat'),
        ref = cat && direct(cat, 'strRef');
      if (ref) edits.push({ ref, values: categories });
      else return fail('Category updates require workbook references');
    }
  }
  if (!edits.length) return undefined;
  const embedded = workbookPart(archive, part, chart);
  const bytes = archive.getPart(embedded)?.data;
  if (!bytes) return fail('Embedded workbook is missing');
  const book = await OpcArchive.open(bytes);
  if (
    [...book.relationships.values()].some((list) => list.some((r) => r.external)) ||
    book.parts.has('/xl/externalLinks/externalLink1.xml') ||
    [...book.parts.keys()].some((p) => /vbaProject|externalLinks|pivot|calcChain/i.test(p))
  )
    return fail('Workbook has unsupported external, macro, pivot or calculation dependencies');

  const documents = new Map<string, Document>();
  const all = bindings(book, chart, documents);
  const changes = new Map<string, ChartChange>();
  for (const edit of edits) {
    const binding = all.find((b) => b.ref === edit.ref);
    if (binding?.cells.length !== edit.values.length)
      return fail('Chart reference range resizing is not supported');
    for (const [i, cell] of binding.cells.entries()) {
      const value = String(edit.values[i]);
      const key = `${cell.part}!${cell.address}`;
      const prior = changes.get(key);
      if (prior?.after !== undefined && prior.after !== value)
        return fail('Conflicting writes to a shared chart source cell');
      changes.set(key, {
        workbook: embedded,
        sheet: cell.sheet,
        address: cell.address,
        before: cell.value,
        after: value,
      });
      if (!binding.numeric && cell.numeric)
        return fail('Cannot write a string into a numeric chart dependency');
    }
  }
  try {
    assertIndependentFormulas(book, [...changes.values()]);
  } catch (cause) {
    return fail(
      cause instanceof Error ? cause.message : String(cause),
      cause instanceof WorkbookDependencyError ? cause.details : undefined,
    );
  }
  // Reject incompatible overlapping string/numeric dependencies before changing cells.
  for (const b of all)
    for (const c of b.cells) {
      const change = changes.get(`${c.part}!${c.address}`);
      if (
        change &&
        b.numeric &&
        (!Number.isFinite(Number(change.after)) || change.after.trim() === '')
      )
        return fail('Conflicting numeric chart dependency');
    }
  for (const b of all)
    for (const c of b.cells) {
      const change = changes.get(`${c.part}!${c.address}`);
      if (!change) continue;
      for (const n of [...children(c.cell)])
        if (n.localName === 'v' || n.localName === 'is') c.cell.removeChild(n);
      const doc = c.cell.ownerDocument;
      if (!doc) return fail('Cell document is missing');
      const numeric = all.some(
        (other) =>
          other.numeric && other.cells.some((x) => x.part === c.part && x.address === c.address),
      );
      c.cell.setAttribute('t', numeric ? 'n' : 'inlineStr');
      const v = doc.createElementNS(S, numeric ? 'v' : 'is');
      if (numeric) v.textContent = change.after;
      else {
        const t = doc.createElementNS(S, 't');
        t.setAttribute('xml:space', 'preserve');
        t.textContent = change.after;
        v.appendChild(t);
      }
      c.cell.appendChild(v);
    }
  for (const [p, doc] of documents) book.writeXml(p, doc);
  return { embedded, book, all, changes: [...changes.values()] };
}
/** Refresh every cache sharing edited cells, including categories and title references. */
export function refreshCaches(data: NonNullable<Awaited<ReturnType<typeof prepareChartData>>>) {
  for (const binding of data.all) {
    for (const n of [...children(binding.cache)])
      if (n.localName === 'pt' || n.localName === 'ptCount') binding.cache.removeChild(n);
    const doc = binding.cache.ownerDocument;
    if (!doc) return fail('Chart document is missing');
    const count = doc.createElementNS(NS.c, 'c:ptCount');
    count.setAttribute('val', String(binding.cells.length));
    binding.cache.appendChild(count);
    for (const [i, cell] of binding.cells.entries()) {
      const change = data.changes.find((c) => c.sheet === cell.sheet && c.address === cell.address);
      const pt = doc.createElementNS(NS.c, 'c:pt');
      pt.setAttribute('idx', String(i));
      const v = doc.createElementNS(NS.c, 'c:v');
      v.textContent = change?.after ?? cell.value;
      pt.appendChild(v);
      binding.cache.appendChild(pt);
    }
  }
}
export async function commitChart(
  archive: OpcArchive,
  original: string,
  chart: Document,
  data: Awaited<ReturnType<typeof prepareChartData>>,
  owner?: ChartOwner,
): Promise<ChartUpdate> {
  let part = original;
  const isolation: ChartUpdate['isolation'] = [];
  let ownerRef: Element | undefined;
  let shared = refs(archive, part) > 1;
  if (owner) {
    ownerRef = descendants(owner.node, 'chart').find((n) => n.namespaceURI === NS.c);
    const rid = ownerRef?.getAttributeNS(NS.r, 'id');
    const source = archive.readXml(owner.part);
    if (descendants(source, 'chart').filter((n) => n.getAttributeNS(NS.r, 'id') === rid).length > 1)
      shared = true;
  }
  if (shared && !ownerRef) return fail('Shared chart requires a valid owning chart reference');
  if (shared && !owner) return fail('Shared chart requires a concrete owning shape');
  if (shared && owner && ownerRef) {
    part = fresh(archive, original);
    const rels = archive.getRelationships(owner.part);
    let n = 1;
    while (rels.some((r) => r.id === `rId${String(n)}`)) n++;
    const id = `rId${String(n)}`;
    archive.setRelationships(
      part,
      archive.getRelationships(original).map((r) => ({ ...r })),
    );
    archive.setRelationships(owner.part, [
      ...rels,
      {
        id,
        type: REL.chart,
        target: posix.relative(posix.dirname(owner.part), part),
        resolvedTarget: part,
        external: false,
      },
    ]);
    ownerRef.setAttributeNS(NS.r, 'r:id', id);
    isolation.push({ from: original, to: part });
  }
  if (data) {
    let embedded = data.embedded;
    const bytes = await data.book.toUint8Array();
    if (refs(archive, embedded) > 1 || shared) {
      embedded = fresh(archive, embedded);
      archive.setRelationships(
        part,
        archive.getRelationships(part).map((r) =>
          r.resolvedTarget === data.embedded
            ? {
                ...r,
                target: posix.relative(posix.dirname(part), embedded),
                resolvedTarget: embedded,
              }
            : r,
        ),
      );
      isolation.push({ from: data.embedded, to: embedded });
    }
    archive.setPart(embedded, bytes, archive.getPart(data.embedded)?.mediaType);
    for (const c of data.changes) c.workbook = embedded;
  }
  archive.writeXml(part, chart, archive.getPart(original)?.mediaType);
  return { workbook: false, chartPart: part, changes: data?.changes ?? [], isolation };
}
export async function verifyChartData(archive: OpcArchive): Promise<ChartVerification[]> {
  const results: ChartVerification[] = [];
  for (const part of archive.parts.keys()) {
    if (!/^\/ppt\/charts\/[^/]+\.xml$/.test(part)) continue;
    try {
      const chart = archive.readXml(part);
      const references = descendants(chart).filter(
        (n) => n.localName === 'numRef' || n.localName === 'strRef',
      );
      if (!references.length) {
        results.push({
          part,
          status: descendants(chart).some((n) => n.namespaceURI?.includes('/chartex'))
            ? 'unverified'
            : 'notApplicable',
        });
        continue;
      }
      const embedded = workbookPart(archive, part, chart);
      const bytes = archive.getPart(embedded)?.data;
      if (!bytes) return fail('Embedded workbook missing');
      const all = bindings(await OpcArchive.open(bytes), chart, new Map());
      let mismatch = false;
      for (const b of all) {
        const points = children(b.cache).filter((n) => n.localName === 'pt');
        if (
          Number(direct(b.cache, 'ptCount')?.getAttribute('val')) !== b.cells.length ||
          points.length !== b.cells.length
        )
          mismatch = true;
        const seen = new Set<number>();
        for (const pt of points) {
          const index = Number(pt.getAttribute('idx'));
          const cell = b.cells[index];
          const value = direct(pt, 'v')?.textContent;
          if (
            !cell ||
            seen.has(index) ||
            value == null ||
            (b.numeric
              ? Number(value) !== Number(cell.value) || value.trim() === ''
              : value !== cell.value)
          )
            mismatch = true;
          seen.add(index);
        }
      }
      results.push({ part, workbook: embedded, status: mismatch ? 'inconsistent' : 'consistent' });
    } catch (cause) {
      results.push({
        part,
        status: 'unverified',
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return results;
}
