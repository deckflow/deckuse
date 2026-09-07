import { err, ok, type Result } from '@deckflow/deckuse-core';
import type { Element } from '@xmldom/xmldom';
import {
  applyShapeProperties,
  shapePropertyKeys,
  type ShapePropertyContext,
} from './properties.js';
import { NS, attr, children, first, setNodeText } from './xml.js';

const DEFAULT_ROW_H = '370840';
const DEFAULT_COL_W = '914400';
const EMU_PER_PT = 12700;
const DEFAULT_STROKE_PT = 1;
const MAX_LINE_WIDTH_EMU = 20116800; // ST_LineWidth maxInclusive
const MAX_LINE_WIDTH_PT = MAX_LINE_WIDTH_EMU / EMU_PER_PT;

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
  tc.appendChild(txBody);
  tc.appendChild(doc.createElementNS(NS.a, 'a:tcPr'));
  return tc;
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
  const tr = doc.createElementNS(NS.a, 'a:tr');
  tr.setAttribute('h', DEFAULT_ROW_H);
  for (let i = 0; i < colCount; i++) tr.appendChild(makeCell(doc, texts[i] ?? ''));
  const anchor = rows[index];
  if (anchor) tbl.insertBefore(tr, anchor);
  else tbl.appendChild(tr);
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
  const gridCol = doc.createElementNS(NS.a, 'a:gridCol');
  gridCol.setAttribute('w', cols[0] ? (attr(cols[0], 'w') ?? DEFAULT_COL_W) : DEFAULT_COL_W);
  const colAnchor = cols[index];
  if (colAnchor) grid.insertBefore(gridCol, colAnchor);
  else grid.appendChild(gridCol);

  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc');
    const cell = makeCell(doc, '');
    const cellAnchor = cells[index];
    if (cellAnchor) row.insertBefore(cell, cellAnchor);
    else row.appendChild(cell);
  }
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

const TABLE_CELL_KEYS = new Set(['text', 'fill']);

export function applyTableProperties(
  node: Element,
  properties: Record<string, unknown>,
  context?: ShapePropertyContext,
): Result<{ applied: string[] }> {
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
  try {
    if ('insertRow' in structural) {
      insertTableRow(node, structural['insertRow']);
      applied.push('insertRow');
    }
    if ('deleteRow' in structural) {
      deleteTableRow(node, structural['deleteRow']);
      applied.push('deleteRow');
    }
    if ('insertColumn' in structural) {
      insertTableColumn(node, structural['insertColumn']);
      applied.push('insertColumn');
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
  } catch (cause) {
    return err(
      'INVALID_COMMAND',
      cause instanceof Error ? cause.message : 'Invalid table properties',
    );
  }
  return ok({ applied });
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
  } catch (cause) {
    return err(
      'INVALID_COMMAND',
      cause instanceof Error ? cause.message : 'Invalid tableCell properties',
    );
  }
  return ok({ applied });
}
