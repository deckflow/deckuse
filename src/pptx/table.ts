import { err, ok, type Diagnostic, type Result } from '../core/index.js';
import type { Element } from '@xmldom/xmldom';
import {
  applyShapeProperties,
  shapePropertyKeys,
  type ShapePropertyContext,
} from './properties.js';
import { readSlideSize } from './slide-size.js';
import {
  estimateTableHeightEmu,
  estimateTableRowHeightEmu,
  layoutTableFrame,
  measureTableLayout,
  type TableFrameLayout,
} from './table-measure.js';
import { NS, attr, children, descendants, first, setNodeText } from './xml.js';

const DEFAULT_ROW_H = '370840';
const DEFAULT_COL_W = '914400';
const EMU_PER_PT = 12700;
const DEFAULT_STROKE_PT = 1;
const MAX_LINE_WIDTH_EMU = 20116800; // ST_LineWidth maxInclusive
const MAX_LINE_WIDTH_PT = MAX_LINE_WIDTH_EMU / EMU_PER_PT;

/** DrawingML 2014 table unique ids (PowerPoint writes these on modern tables). */
const NS_A16 = 'http://schemas.microsoft.com/office/drawing/2014/main';
const COL_ID_URI = '{9D8B030D-6E8A-4147-A177-3AD203B41FA5}';
const ROW_ID_URI = '{0D108BD9-81ED-4DB2-BD59-A6C34878D82A}';

/** Convert line.width to EMU. Values above max pt are treated as already-EMU. */
const lineWidthToEmu = (width: number): number => {
  const emu = width > MAX_LINE_WIDTH_PT ? Math.round(width) : Math.round(width * EMU_PER_PT);
  return Math.min(MAX_LINE_WIDTH_EMU, Math.max(1, emu));
};
const STROKE_ALIASES = ['stroke', 'border', 'outline', 'line'] as const;
const TABLE_CELL_BORDER_SIDES = ['lnL', 'lnR', 'lnT', 'lnB'] as const;
const TABLE_CELL_BORDER_LOCAL = new Set<string>([
  ...TABLE_CELL_BORDER_SIDES,
  'lnTlToBr',
  'lnBlToTr',
  'cell3D',
]);
const TABLE_CELL_FILL_LOCAL = new Set([
  'noFill',
  'solidFill',
  'gradFill',
  'blipFill',
  'pattFill',
  'grpFill',
]);
const SHAPE_KEY_SET = new Set(shapePropertyKeys);

/** Insert fill after border sides (OOXML CT_TableCellProperties order). */
const insertTcPrFill = (tcPr: Element, fill: Element): void => {
  const kids = children(tcPr);
  let lastBorder: Element | undefined;
  for (const child of kids)
    if (child.localName && TABLE_CELL_BORDER_LOCAL.has(child.localName)) lastBorder = child;
  if (lastBorder?.nextSibling) tcPr.insertBefore(fill, lastBorder.nextSibling);
  else if (lastBorder) tcPr.appendChild(fill);
  else if (tcPr.firstChild) tcPr.insertBefore(fill, tcPr.firstChild);
  else tcPr.appendChild(fill);
};

/** Insert a border side before fill / margins (OOXML CT_TableCellProperties order). */
const insertTcPrBorder = (tcPr: Element, ln: Element): void => {
  const kids = children(tcPr);
  const fillOrLater = kids.find(
    (child) => child.localName && !TABLE_CELL_BORDER_LOCAL.has(child.localName),
  );
  if (fillOrLater) tcPr.insertBefore(ln, fillOrLater);
  else tcPr.appendChild(ln);
};

const directChildren = (node: Element, localName: string): Element[] =>
  children(node).filter((c) => c.localName === localName);

const normalizeColor = (value: string): string => {
  const hex = value.trim().replace(/^#/, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(hex)) throw new Error(`Invalid color: ${value}`);
  return hex;
};

const isNone = (value: unknown): boolean => {
  if (value === null || value === false || value === 'none') return true;
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type?: unknown }).type === 'none'
  );
};

const tblOf = (node: Element): Element => {
  const tbl = first(node, 'tbl');
  if (!tbl) throw new Error('Table element has no a:tbl');
  return tbl;
};

const makeCell = (doc: NonNullable<Element['ownerDocument']>, text = ''): Element => {
  const tc = doc.createElementNS(NS.a, 'a:tc');
  const txBody = doc.createElementNS(NS.a, 'a:txBody');
  txBody.appendChild(doc.createElementNS(NS.a, 'a:bodyPr'));
  txBody.appendChild(doc.createElementNS(NS.a, 'a:lstStyle'));
  const p = doc.createElementNS(NS.a, 'a:p');
  const r = doc.createElementNS(NS.a, 'a:r');
  const t = doc.createElementNS(NS.a, 'a:t');
  t.appendChild(doc.createTextNode(text));
  r.appendChild(t);
  p.appendChild(r);
  txBody.appendChild(p);
  tc.appendChild(doc.createElementNS(NS.a, 'a:tcPr'));
  return tc;
};

/** Clone a cell's formatting (tcPr, bodyPr, lstStyle, pPr, rPr) and set plain text. */
const cloneCellWithText = (template: Element, text: string): Element => {
  const doc = template.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  const tc = template.cloneNode(true) as Element;
  // Drop a16 / extLst unique ids that must not be duplicated on the new cell.
  for (const extLst of [...descendants(tc, 'extLst')]) extLst.parentNode?.removeChild(extLst);
  setNodeText(tc, text);
  return tc;
};

const growFrame = (graphicFrame: Element, deltaCx: number, deltaCy: number): void => {
  const xfrm = first(graphicFrame, 'xfrm');
  const ext = xfrm ? first(xfrm, 'ext') : undefined;
  if (!ext) return;
  if (deltaCx !== 0) {
    const cx = Number(attr(ext, 'cx') ?? 0);
    ext.setAttribute('cx', String(Math.max(1, Math.round(cx + deltaCx))));
  }
  if (deltaCy !== 0) {
    const cy = Number(attr(ext, 'cy') ?? 0);
    ext.setAttribute('cy', String(Math.max(1, Math.round(cy + deltaCy))));
  }
};

type FrameBox = { x: number; y: number; cx: number; cy: number };

const frameBoxOf = (node: Element): FrameBox | undefined => {
  const xfrm = first(node, 'xfrm');
  const off = xfrm ? first(xfrm, 'off') : undefined;
  const ext = xfrm ? first(xfrm, 'ext') : undefined;
  if (!off || !ext) return undefined;
  const x = Number(attr(off, 'x') ?? 0);
  const y = Number(attr(off, 'y') ?? 0);
  const cx = Number(attr(ext, 'cx') ?? 0);
  const cy = Number(attr(ext, 'cy') ?? 0);
  if (![x, y, cx, cy].every(Number.isFinite)) return undefined;
  return { x, y, cx, cy };
};

const boxesIntersect = (a: FrameBox, b: FrameBox): boolean =>
  a.x < b.x + b.cx && a.x + a.cx > b.x && a.y < b.y + b.cy && a.y + a.cy > b.y;

const SHAPE_FRAME_LOCAL = new Set(['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp']);

/** Warn when a grown table overlaps peers or extends past the slide bottom. */
export const tableLayoutWarnings = (
  graphicFrame: Element,
  context?: ShapePropertyContext,
): Diagnostic[] => {
  const box = frameBoxOf(graphicFrame);
  if (!box) return [];
  const diagnostics: Diagnostic[] = [];
  if (context?.archive) {
    const { heightEmu } = readSlideSize(context.archive);
    if (box.y + box.cy > heightEmu) {
      diagnostics.push({
        severity: 'warning',
        code: 'TABLE_EXTENDS_PAST_SLIDE',
        message: `Table bottom (${String(box.y + box.cy)} EMU) extends past slide height (${String(heightEmu)} EMU)`,
        details: { bottomEmu: box.y + box.cy, slideHeightEmu: heightEmu },
      });
    }
  }
  const doc = graphicFrame.ownerDocument;
  if (!doc) return diagnostics;
  for (const peer of descendants(doc)) {
    if (peer === graphicFrame) continue;
    if (!peer.localName || !SHAPE_FRAME_LOCAL.has(peer.localName)) continue;
    const other = frameBoxOf(peer);
    if (!other || other.cx <= 0 || other.cy <= 0) continue;
    if (boxesIntersect(box, other)) {
      const name = attr(first(peer, 'cNvPr'), 'name') ?? peer.localName;
      diagnostics.push({
        severity: 'warning',
        code: 'TABLE_OVERLAPS_SHAPE',
        message: `Table frame overlaps shape "${name}" after structural edit; consider setTableLayout to reflow`,
        details: { peer: name },
      });
      break;
    }
  }
  return diagnostics;
};

/** True when any gridCol already carries a16:colId (PowerPoint modern table). */
const tableUsesColIds = (tbl: Element): boolean =>
  descendants(tbl, 'colId').some(
    (el) => el.namespaceURI === NS_A16 || el.prefix === 'a16' || el.localName === 'colId',
  );

/** True when any row already carries a16:rowId. */
const tableUsesRowIds = (tbl: Element): boolean =>
  descendants(tbl, 'rowId').some(
    (el) => el.namespaceURI === NS_A16 || el.prefix === 'a16' || el.localName === 'rowId',
  );

const nextTableUniqueId = (tbl: Element, localName: 'colId' | 'rowId'): string => {
  let max = 0;
  for (const el of descendants(tbl, localName)) {
    const n = Number(attr(el, 'val') ?? 0);
    if (Number.isFinite(n) && n > max) max = n;
  }
  // PowerPoint typically uses 10000+ for rows and 20000+ for cols; stay above either.
  return String(Math.max(max + 1, localName === 'colId' ? 20000 : 10000));
};

const attachA16Id = (parent: Element, kind: 'colId' | 'rowId', id: string): void => {
  const doc = parent.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  const uri = kind === 'colId' ? COL_ID_URI : ROW_ID_URI;
  const extLst = doc.createElementNS(NS.a, 'a:extLst');
  const ext = doc.createElementNS(NS.a, 'a:ext');
  ext.setAttribute('uri', uri);
  const idEl = doc.createElementNS(NS_A16, `a16:${kind}`);
  idEl.setAttribute('val', id);
  ext.appendChild(idEl);
  extLst.appendChild(ext);
  parent.appendChild(extLst);
};

const parseIndex = (value: unknown, name: string): number => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'object' && value !== null && 'index' in value) {
    const index = (value as { index?: unknown }).index;
    if (typeof index === 'number' && Number.isInteger(index) && index >= 0) return index;
  }
  throw new Error(`${name} requires a non-negative integer index`);
};

const cellsFromSpec = (value: unknown): string[] | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const cells = (value as { cells?: unknown }).cells;
  if (cells === undefined) return undefined;
  if (!Array.isArray(cells) || !cells.every((c) => typeof c === 'string'))
    throw new Error('cells must be an array of strings');
  return cells;
};

export function insertTableRow(node: Element, spec: unknown): void {
  const tbl = tblOf(node);
  const doc = node.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  const index = parseIndex(spec, 'insertRow');
  const rows = directChildren(tbl, 'tr');
  const grid = first(tbl, 'tblGrid');
  const colCount = grid
    ? directChildren(grid, 'gridCol').length
    : rows[0]
      ? directChildren(rows[0], 'tc').length
      : 1;
  const texts = cellsFromSpec(spec) ?? Array.from({ length: colCount }, () => '');
  // Inherit from the row at the insert point, or the last row when appending.
  const templateRow = rows[index] ?? rows[rows.length - 1];
  const templateCells = templateRow ? directChildren(templateRow, 'tc') : [];
  const rowH = templateRow ? (attr(templateRow, 'h') ?? DEFAULT_ROW_H) : DEFAULT_ROW_H;
  const tr = doc.createElementNS(NS.a, 'a:tr');
  tr.setAttribute('h', rowH);
  for (let i = 0; i < colCount; i++) {
    const text = texts[i] ?? '';
    const template = templateCells[i];
    tr.appendChild(template ? cloneCellWithText(template, text) : makeCell(doc, text));
  }
  // Keep a16:rowId complete when the source table already uses them — partial
  // coverage makes PowerPoint prompt to repair the package.
  if (tableUsesRowIds(tbl)) attachA16Id(tr, 'rowId', nextTableUniqueId(tbl, 'rowId'));
  const anchor = rows[index];
  if (anchor) tbl.insertBefore(tr, anchor);
  else tbl.appendChild(tr);
  growFrame(node, 0, Number(rowH) || Number(DEFAULT_ROW_H));
}

export function deleteTableRow(node: Element, spec: unknown): void {
  const tbl = tblOf(node);
  const index = parseIndex(spec, 'deleteRow');
  const rows = directChildren(tbl, 'tr');
  if (rows.length <= 1) throw new Error('Cannot delete the last table row');
  const row = rows[index];
  if (!row) throw new Error(`deleteRow index ${String(index)} out of range`);
  tbl.removeChild(row);
}

export function insertTableColumn(node: Element, spec: unknown): void {
  const tbl = tblOf(node);
  const doc = node.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  const index = parseIndex(spec, 'insertColumn');
  let grid = first(tbl, 'tblGrid');
  if (!grid) {
    grid = doc.createElementNS(NS.a, 'a:tblGrid');
    const firstRow = directChildren(tbl, 'tr')[0];
    if (firstRow) tbl.insertBefore(grid, firstRow);
    else tbl.appendChild(grid);
  }
  const cols = directChildren(grid, 'gridCol');
  const templateCol = cols[index] ?? cols[cols.length - 1];
  const colW = templateCol ? (attr(templateCol, 'w') ?? DEFAULT_COL_W) : DEFAULT_COL_W;
  const gridCol = doc.createElementNS(NS.a, 'a:gridCol');
  gridCol.setAttribute('w', colW);
  if (tableUsesColIds(tbl)) attachA16Id(gridCol, 'colId', nextTableUniqueId(tbl, 'colId'));
  const colAnchor = cols[index];
  if (colAnchor) grid.insertBefore(gridCol, colAnchor);
  else grid.appendChild(gridCol);

  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc');
    const template = cells[index] ?? cells[cells.length - 1];
    const cell = template ? cloneCellWithText(template, '') : makeCell(doc, '');
    const cellAnchor = cells[index];
    if (cellAnchor) row.insertBefore(cell, cellAnchor);
    else row.appendChild(cell);
  }
  growFrame(node, Number(colW) || Number(DEFAULT_COL_W), 0);
}

export function deleteTableColumn(node: Element, spec: unknown): void {
  const tbl = tblOf(node);
  const index = parseIndex(spec, 'deleteColumn');
  const grid = first(tbl, 'tblGrid');
  const cols = grid ? directChildren(grid, 'gridCol') : [];
  const rowCells = directChildren(tbl, 'tr').map((r) => directChildren(r, 'tc').length);
  if ((cols.length || Math.max(0, ...rowCells)) <= 1)
    throw new Error('Cannot delete the last table column');
  if (grid) {
    const col = cols[index];
    if (!col) throw new Error(`deleteColumn index ${String(index)} out of range`);
    grid.removeChild(col);
  }
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc');
    const cell = cells[index];
    if (!cell) throw new Error(`deleteColumn index ${String(index)} out of range`);
    row.removeChild(cell);
  }
}

export function setTableCellFill(cell: Element, value: unknown): void {
  const doc = cell.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  let tcPr = directChildren(cell, 'tcPr')[0] ?? first(cell, 'tcPr');
  if (!tcPr) {
    tcPr = doc.createElementNS(NS.a, 'a:tcPr');
    cell.appendChild(tcPr);
  }
  for (const child of [...children(tcPr)])
    if (child.localName && TABLE_CELL_FILL_LOCAL.has(child.localName)) tcPr.removeChild(child);

  if (isNone(value)) {
    insertTcPrFill(tcPr, doc.createElementNS(NS.a, 'a:noFill'));
    return;
  }
  let color: string;
  if (typeof value === 'string') color = normalizeColor(value);
  else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record['color'] !== 'string') throw new Error('fill.color must be a hex string');
    color = normalizeColor(record['color']);
  } else throw new Error('Unsupported fill value');

  const solidFill = doc.createElementNS(NS.a, 'a:solidFill');
  const srgb = doc.createElementNS(NS.a, 'a:srgbClr');
  srgb.setAttribute('val', color);
  solidFill.appendChild(srgb);
  insertTcPrFill(tcPr, solidFill);
}

const ensureTcPr = (cell: Element): Element => {
  const doc = cell.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  let tcPr = directChildren(cell, 'tcPr')[0] ?? first(cell, 'tcPr');
  if (!tcPr) {
    tcPr = doc.createElementNS(NS.a, 'a:tcPr');
    cell.appendChild(tcPr);
  }
  return tcPr;
};

const tableCells = (node: Element): Element[] =>
  directChildren(tblOf(node), 'tr').flatMap((tr) => directChildren(tr, 'tc'));

const setTableCellBorders = (cell: Element, value: unknown): void => {
  const doc = cell.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  const tcPr = ensureTcPr(cell);
  for (const child of [...children(tcPr)])
    if (child.localName && (TABLE_CELL_BORDER_SIDES as readonly string[]).includes(child.localName))
      tcPr.removeChild(child);

  if (isNone(value)) {
    for (const side of TABLE_CELL_BORDER_SIDES) {
      const ln = doc.createElementNS(NS.a, `a:${side}`);
      ln.appendChild(doc.createElementNS(NS.a, 'a:noFill'));
      insertTcPrBorder(tcPr, ln);
    }
    return;
  }

  let color = '0000FF';
  let widthPt = DEFAULT_STROKE_PT;
  let dash: string | undefined;
  if (typeof value === 'string') color = normalizeColor(value);
  else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record['color'] === 'string') color = normalizeColor(record['color']);
    else if (record['color'] !== undefined) throw new Error('stroke.color must be a hex string');
    const width = record['width'] ?? record['widthPt'];
    if (typeof width === 'number' && Number.isFinite(width) && width > 0) widthPt = width;
    else if (width !== undefined) throw new Error('stroke.width must be a positive number (pt)');
    if (typeof record['dash'] === 'string') dash = record['dash'];
    else if (record['dash'] !== undefined) throw new Error('stroke.dash must be a string');
  } else throw new Error('Unsupported stroke value');

  const widthEmu = String(lineWidthToEmu(widthPt));
  for (const side of TABLE_CELL_BORDER_SIDES) {
    const ln = doc.createElementNS(NS.a, `a:${side}`);
    ln.setAttribute('w', widthEmu);
    const solidFill = doc.createElementNS(NS.a, 'a:solidFill');
    const srgb = doc.createElementNS(NS.a, 'a:srgbClr');
    srgb.setAttribute('val', color);
    solidFill.appendChild(srgb);
    ln.appendChild(solidFill);
    if (dash) {
      const prstDash = doc.createElementNS(NS.a, 'a:prstDash');
      prstDash.setAttribute('val', dash);
      ln.appendChild(prstDash);
    }
    insertTcPrBorder(tcPr, ln);
  }
};

const TABLE_STRUCTURAL_KEYS = new Set([
  'insertRow',
  'deleteRow',
  'insertColumn',
  'deleteColumn',
  'text',
  'name',
]);

const TABLE_CELL_STROKE_ALIASES = ['stroke', 'border', 'outline', 'line'] as const;
const TABLE_CELL_PADDING_KEYS = [
  'padding.left',
  'padding.right',
  'padding.top',
  'padding.bottom',
] as const;
const TABLE_CELL_PADDING_ATTR: Record<(typeof TABLE_CELL_PADDING_KEYS)[number], string> = {
  'padding.left': 'marL',
  'padding.right': 'marR',
  'padding.top': 'marT',
  'padding.bottom': 'marB',
};
const TABLE_CELL_FONT_KEYS = new Set([
  'fontSize',
  'fontFamily',
  'textColor',
  'bold',
  'italic',
  'font',
  'typeface',
  'size',
  'fontColor',
]);
const TABLE_CELL_KEYS = new Set([
  'text',
  'fill',
  'paragraph.align',
  ...TABLE_CELL_STROKE_ALIASES,
  ...TABLE_CELL_PADDING_KEYS,
  ...TABLE_CELL_FONT_KEYS,
]);

const setTableCellPadding = (cell: Element, properties: Record<string, unknown>): string[] => {
  const applied: string[] = [];
  const present = TABLE_CELL_PADDING_KEYS.filter((key) => key in properties);
  if (present.length === 0) return applied;
  const tcPr = ensureTcPr(cell);
  for (const key of present) {
    const value = properties[key];
    if (typeof value !== 'number' || !(value >= 0) || !Number.isFinite(value))
      throw new Error(`${key} must be a non-negative number (pt)`);
    tcPr.setAttribute(TABLE_CELL_PADDING_ATTR[key], String(Math.round(value * EMU_PER_PT)));
    applied.push(key);
  }
  return applied;
};

export function applyTableProperties(
  node: Element,
  properties: Record<string, unknown>,
  context?: ShapePropertyContext,
): Result<{ applied: string[]; diagnostics: Diagnostic[] }> {
  const structural: Record<string, unknown> = {};
  const visual: Record<string, unknown> = {};
  const unexpected: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    if (TABLE_STRUCTURAL_KEYS.has(key)) structural[key] = value;
    else if (SHAPE_KEY_SET.has(key)) visual[key] = value;
    else unexpected.push(key);
  }
  if (unexpected.length)
    return err('INVALID_COMMAND', `Unsupported table setProperties keys: ${unexpected.join(', ')}`);

  const applied: string[] = [];
  const diagnostics: Diagnostic[] = [];
  let structureGrew = false;
  try {
    if ('insertRow' in structural) {
      insertTableRow(node, structural['insertRow']);
      applied.push('insertRow');
      structureGrew = true;
    }
    if ('deleteRow' in structural) {
      deleteTableRow(node, structural['deleteRow']);
      applied.push('deleteRow');
    }
    if ('insertColumn' in structural) {
      insertTableColumn(node, structural['insertColumn']);
      applied.push('insertColumn');
      structureGrew = true;
    }
    if ('deleteColumn' in structural) {
      deleteTableColumn(node, structural['deleteColumn']);
      applied.push('deleteColumn');
    }
    if (typeof structural['text'] === 'string') {
      setNodeText(node, structural['text']);
      applied.push('text');
    } else if (structural['text'] !== undefined) throw new Error('text must be a string');
    if (typeof structural['name'] === 'string') {
      const pr = first(node, 'cNvPr');
      if (!pr) throw new Error('Element has no cNvPr to set name');
      pr.setAttribute('name', structural['name']);
      applied.push('name');
    } else if (structural['name'] !== undefined) throw new Error('name must be a string');

    // Table fill/line map onto cells — graphicFrame has no spPr.
    if ('fill' in visual) {
      const cells = tableCells(node);
      if (cells.length === 0) throw new Error('Table has no cells to fill');
      for (const cell of cells) setTableCellFill(cell, visual['fill']);
      applied.push('fill');
      delete visual['fill'];
    }

    const strokeKeys = STROKE_ALIASES.filter((key) => key in visual);
    if (strokeKeys.length > 1)
      throw new Error(`Use only one stroke alias; found: ${strokeKeys.join(', ')}`);
    if (strokeKeys[0]) {
      const key = strokeKeys[0];
      const cells = tableCells(node);
      if (cells.length === 0) throw new Error('Table has no cells for stroke');
      for (const cell of cells) setTableCellBorders(cell, visual[key]);
      applied.push(key);
      delete visual[key];
    }

    if (Object.keys(visual).length > 0) {
      const styled = applyShapeProperties(node, visual, context);
      if (!styled.ok) return styled;
      applied.push(...styled.value.applied);
    }
    if (structureGrew) diagnostics.push(...tableLayoutWarnings(node, context));
  } catch (cause) {
    return err(
      'INVALID_COMMAND',
      cause instanceof Error ? cause.message : 'Invalid table properties',
    );
  }
  return ok({ applied, diagnostics });
}

export function applyTableCellProperties(
  node: Element,
  properties: Record<string, unknown>,
): Result<{ applied: string[] }> {
  const unexpected = Object.keys(properties).filter((k) => !TABLE_CELL_KEYS.has(k));
  if (unexpected.length)
    return err(
      'INVALID_COMMAND',
      `Unsupported tableCell setProperties keys: ${unexpected.join(', ')}`,
    );
  const applied: string[] = [];
  try {
    if (typeof properties['text'] === 'string') {
      setNodeText(node, properties['text']);
      applied.push('text');
    } else if (properties['text'] !== undefined) throw new Error('text must be a string');
    if ('fill' in properties) {
      setTableCellFill(node, properties['fill']);
      applied.push('fill');
    }

    const strokeKeys = TABLE_CELL_STROKE_ALIASES.filter((key) => key in properties);
    if (strokeKeys.length > 1)
      throw new Error(`Use only one stroke alias; found: ${strokeKeys.join(', ')}`);
    if (strokeKeys[0]) {
      setTableCellBorders(node, properties[strokeKeys[0]]);
      applied.push(strokeKeys[0]);
    }

    applied.push(...setTableCellPadding(node, properties));

    const styleProps: Record<string, unknown> = {};
    if ('paragraph.align' in properties)
      styleProps['paragraph.align'] = properties['paragraph.align'];
    for (const key of TABLE_CELL_FONT_KEYS) {
      if (key in properties) styleProps[key] = properties[key];
    }
    if (Object.keys(styleProps).length > 0) {
      const styled = applyShapeProperties(node, styleProps);
      if (!styled.ok) return styled;
      applied.push(...styled.value.applied);
    }
  } catch (cause) {
    return err(
      'INVALID_COMMAND',
      cause instanceof Error ? cause.message : 'Invalid tableCell properties',
    );
  }
  return ok({ applied });
}

const cellPlainText = (tc: Element): string =>
  descendants(tc, 't')
    .map((t) => t.textContent ?? '')
    .join('');

/** Read table grid width (sum of gridCol) or fall back to graphicFrame cx. */
const tableWidthEmu = (graphicFrame: Element): number => {
  const gridCols = descendants(graphicFrame, 'gridCol');
  if (gridCols.length > 0) {
    const sum = gridCols.reduce((acc, col) => acc + Number(attr(col, 'w') ?? 0), 0);
    if (sum > 0) return sum;
  }
  const xfrm = first(graphicFrame, 'xfrm');
  const ext = xfrm ? first(xfrm, 'ext') : undefined;
  return Number(attr(ext, 'cx') ?? 914400);
};

export function applyTableLayout(
  graphicFrame: Element,
  options: {
    height?: 'auto' | number;
    redistribute?: 'equal' | 'content';
  },
): Result<{
  applied: string[];
  totalHeightEmu: number;
  estimatedEmu?: number;
  layout: TableFrameLayout;
}> {
  if (graphicFrame.localName !== 'graphicFrame')
    return err('INVALID_COMMAND', 'setTableLayout target must be a table graphicFrame');
  const tbl = first(graphicFrame, 'tbl');
  if (!tbl) return err('INVALID_COMMAND', 'Target is not a DrawingML table');
  const rows = directChildren(tbl, 'tr');
  if (rows.length === 0) return err('INVALID_COMMAND', 'Table has no rows');

  const widthEmu = tableWidthEmu(graphicFrame);
  const textRows = rows.map((tr) => directChildren(tr, 'tc').map((tc) => cellPlainText(tc)));
  const redistribute =
    options.redistribute ??
    (options.height === 'auto' || options.height === undefined ? 'content' : 'equal');

  const xfrm = first(graphicFrame, 'xfrm');
  const ext = xfrm ? first(xfrm, 'ext') : undefined;
  if (!ext) return err('INVALID_COMMAND', 'Table graphicFrame has no xfrm/ext');

  const applied: string[] = [];
  let totalHeightEmu: number;
  let estimatedEmu: number | undefined;

  let layout: TableFrameLayout;
  if (redistribute === 'content' || options.height === 'auto') {
    const measured = measureTableLayout({ rows: textRows, widthEmu, fontPt: 11 });
    layout = layoutTableFrame({
      contentRowHeightsEmu: measured.rowHeightsEmu,
      contentEmu: measured.totalHeightEmu,
      ...(typeof options.height === 'number' ? { frameEmu: options.height } : {}),
    });
    estimatedEmu = layout.contentEmu;
    totalHeightEmu = layout.frameEmu;
    for (let i = 0; i < rows.length; i++) {
      const h = layout.rowHeightsEmu[i] ?? estimateTableRowHeightEmu(11);
      rows[i]!.setAttribute('h', String(h));
    }
    applied.push('redistribute:content');
  } else {
    totalHeightEmu =
      typeof options.height === 'number'
        ? options.height
        : Number(attr(ext, 'cy') ?? estimateTableHeightEmu(rows.length));
    const measured = measureTableLayout({ rows: textRows, widthEmu, fontPt: 11 });
    const rowH = Math.max(1, Math.floor(totalHeightEmu / rows.length));
    const rowHeightsEmu: number[] = [];
    let assigned = 0;
    for (let i = 0; i < rows.length; i++) {
      const h = i === rows.length - 1 ? Math.max(1, totalHeightEmu - assigned) : rowH;
      rows[i]!.setAttribute('h', String(h));
      rowHeightsEmu.push(h);
      assigned += h;
    }
    layout = {
      mode: 'fixed',
      status: totalHeightEmu < measured.totalHeightEmu ? 'overflow' : 'complete',
      frameEmu: Math.round(totalHeightEmu),
      contentEmu: measured.totalHeightEmu,
      rowHeightsEmu,
    };
    estimatedEmu = measured.totalHeightEmu;
    applied.push('redistribute:equal');
  }

  ext.setAttribute('cy', String(Math.round(totalHeightEmu)));
  applied.push('height');
  return ok({
    applied,
    totalHeightEmu,
    ...(estimatedEmu !== undefined ? { estimatedEmu } : {}),
    layout,
  });
}
