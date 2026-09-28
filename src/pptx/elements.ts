import { OpcArchive, parseXml } from '../opc/index.js';
import type { Document, Element } from '@xmldom/xmldom';
import { parseLength, type LengthInput } from '../core/index.js';
import {
  applyChartProperties,
  chartGraphicFrameXml,
  createChartPart,
  type ChartType,
} from './chart.js';
import { addMediaPart, mediaPicXml } from './media.js';
import { addPicturePart } from './picture.js';
import { normalizePlaceholderRole } from './placeholder-role.js';
import { lengthContextFor } from './slide-size.js';
import {
  estimateTableRowHeightEmu,
  layoutTableFrame,
  measureTableLayout,
  type TableFrameLayout,
} from './table-measure.js';
import { NS, REL, allocateShapeIds, attr, descendants, nextShapeId } from './xml.js';

export {
  estimateTableHeightEmu,
  estimateTableRowHeightEmu,
  layoutTableFrame,
  measureTableLayout,
} from './table-measure.js';
export type { TableFrameLayout } from './table-measure.js';
const esc = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const value = (obj: Record<string, unknown>, key: string, fallback: string): string =>
  typeof obj[key] === 'string' ? obj[key] : fallback;
const num = (obj: Record<string, unknown>, key: string, fallback: number): number =>
  typeof obj[key] === 'number' ? obj[key] : fallback;

const resolveEmu = (
  raw: unknown,
  fallback: number,
  axis: 'x' | 'y',
  archive?: OpcArchive,
): number => {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'number' || typeof raw === 'string') {
    try {
      return parseLength(raw as LengthInput, {
        ...(archive ? lengthContextFor(archive, axis) : {}),
        axis,
      });
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const xfrm = (e: Record<string, unknown>, archive?: OpcArchive) =>
  `<a:xfrm><a:off x="${String(resolveEmu(e['x'], 0, 'x', archive))}" y="${String(resolveEmu(e['y'], 0, 'y', archive))}"/><a:ext cx="${String(resolveEmu(e['width'], 914400, 'x', archive))}" cy="${String(resolveEmu(e['height'], 914400, 'y', archive))}"/></a:xfrm>`;
/** graphicFrame uses PresentationML p:xfrm (not DrawingML a:xfrm). */
const graphicFrameXfrm = (e: Record<string, unknown>, archive?: OpcArchive) =>
  `<p:xfrm><a:off x="${String(resolveEmu(e['x'], 0, 'x', archive))}" y="${String(resolveEmu(e['y'], 0, 'y', archive))}"/><a:ext cx="${String(resolveEmu(e['width'], 914400, 'x', archive))}" cy="${String(resolveEmu(e['height'], 914400, 'y', archive))}"/></p:xfrm>`;
const textBody = (
  text: string,
  options: {
    anchor?: string;
    wrap?: string;
    insets?: { left?: number; right?: number; top?: number; bottom?: number };
    autofit?: 'none' | 'shrink' | 'resize';
  } = {},
) => {
  const lines = text.split('\n');
  const attrs: string[] = [];
  if (options.anchor) attrs.push(`anchor="${esc(options.anchor)}"`);
  if (options.wrap) attrs.push(`wrap="${esc(options.wrap)}"`);
  if (options.insets?.left !== undefined) attrs.push(`lIns="${String(options.insets.left)}"`);
  if (options.insets?.right !== undefined) attrs.push(`rIns="${String(options.insets.right)}"`);
  if (options.insets?.top !== undefined) attrs.push(`tIns="${String(options.insets.top)}"`);
  if (options.insets?.bottom !== undefined) attrs.push(`bIns="${String(options.insets.bottom)}"`);
  const autofitChild =
    options.autofit === 'none'
      ? '<a:noAutofit/>'
      : options.autofit === 'shrink'
        ? '<a:normAutofit/>'
        : options.autofit === 'resize'
          ? '<a:spAutoFit/>'
          : '';
  const bodyPrAttrs = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
  const bodyPr =
    autofitChild.length > 0
      ? `<a:bodyPr${bodyPrAttrs}>${autofitChild}</a:bodyPr>`
      : `<a:bodyPr${bodyPrAttrs}/>`;
  return `<p:txBody>${bodyPr}<a:lstStyle/>${lines
    .map((line) => `<a:p><a:r><a:t>${esc(line)}</a:t></a:r></a:p>`)
    .join('')}</p:txBody>`;
};
const nvPrXml = (e: Record<string, unknown>) => {
  const role = typeof e['role'] === 'string' ? e['role'] : undefined;
  if (!role) return '<p:nvPr/>';
  const normalized = normalizePlaceholderRole(role);
  if (!normalized.ok) throw new Error(normalized.message);
  const idx = typeof e['placeholderIdx'] === 'string' ? e['placeholderIdx'] : undefined;
  const idxAttr = idx !== undefined ? ` idx="${esc(idx)}"` : '';
  return `<p:nvPr><p:ph type="${esc(normalized.type)}"${idxAttr}/></p:nvPr>`;
};
const avLstXml = (e: Record<string, unknown>): string => {
  const preset = value(e, 'preset', 'rect');
  if (preset === 'roundRect' && typeof e['cornerRadius'] === 'number') {
    const adj = Math.round(Math.min(1, Math.max(0, e['cornerRadius'])) * 50_000);
    return `<a:avLst><a:gd name="adj" fmla="val ${String(adj)}"/></a:avLst>`;
  }
  const adjust = e['adjust'];
  if (typeof adjust === 'object' && adjust !== null) {
    const entries = Object.entries(adjust as Record<string, unknown>).filter(
      ([, v]) => typeof v === 'number' && Number.isFinite(v),
    );
    if (entries.length > 0) {
      return `<a:avLst>${entries
        .map(([name, v]) => {
          const n = v as number;
          // Values in 0–1 are treated as fractions → OOXML 0–100000 (or 50000 for adj).
          const raw = n >= 0 && n <= 1 ? Math.round(n * 100_000) : Math.round(n);
          return `<a:gd name="${esc(name)}" fmla="val ${String(raw)}"/>`;
        })
        .join('')}</a:avLst>`;
    }
  }
  return '<a:avLst/>';
};

const resolveInsets = (
  e: Record<string, unknown>,
  archive?: OpcArchive,
): { left?: number; right?: number; top?: number; bottom?: number } | undefined => {
  const raw = e['insets'];
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const out: { left?: number; right?: number; top?: number; bottom?: number } = {};
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    if (record[side] === undefined) continue;
    out[side] = resolveEmu(
      record[side],
      0,
      side === 'left' || side === 'right' ? 'x' : 'y',
      archive,
    );
  }
  return out;
};

const shapeXml = (id: number, e: Record<string, unknown>, archive?: OpcArchive) => {
  const preset = value(e, 'preset', 'rect');
  const txBox = e['txBox'] === false ? '' : ' txBox="1"';
  // Non-textbox shapes default to vertical center (PowerPoint UI behavior).
  const isTextBox = e['kind'] === 'textbox' || e['type'] === 'textbox';
  const defaultAnchor = isTextBox ? undefined : 'ctr';
  const anchor = typeof e['anchor'] === 'string' ? e['anchor'] : defaultAnchor;
  const wrap = typeof e['wrap'] === 'string' ? e['wrap'] : undefined;
  const insets = resolveInsets(e, archive);
  const autofit =
    e['autofit'] === 'none' || e['autofit'] === 'shrink' || e['autofit'] === 'resize'
      ? e['autofit']
      : undefined;
  return `<p:sp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvSpPr><p:cNvPr id="${String(id)}" name="${esc(value(e, 'name', `Shape ${String(id)}`))}"/><p:cNvSpPr${txBox}/>${nvPrXml(e)}</p:nvSpPr><p:spPr>${xfrm(e, archive)}<a:prstGeom prst="${esc(preset)}">${avLstXml(e)}</a:prstGeom></p:spPr>${textBody(
    value(e, 'text', ''),
    {
      ...(anchor ? { anchor } : {}),
      ...(wrap ? { wrap } : {}),
      ...(insets ? { insets } : {}),
      ...(autofit ? { autofit } : {}),
    },
  )}</p:sp>`;
};
const connectorXml = (id: number, e: Record<string, unknown>, archive?: OpcArchive) => {
  const preset = value(e, 'preset', 'line');
  return `<p:cxnSp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvCxnSpPr><p:cNvPr id="${String(id)}" name="${esc(value(e, 'name', `Connector ${String(id)}`))}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(e, archive)}<a:prstGeom prst="${esc(preset)}"><a:avLst/></a:prstGeom></p:spPr></p:cxnSp>`;
};
const groupXml = (id: number, e: Record<string, unknown>, archive?: OpcArchive) => {
  const w = resolveEmu(e['width'], 914400, 'x', archive);
  const h = resolveEmu(e['height'], 914400, 'y', archive);
  return `<p:grpSp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvGrpSpPr><p:cNvPr id="${String(id)}" name="${esc(value(e, 'name', `Group ${String(id)}`))}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${String(resolveEmu(e['x'], 0, 'x', archive))}" y="${String(resolveEmu(e['y'], 0, 'y', archive))}"/><a:ext cx="${String(w)}" cy="${String(h)}"/><a:chOff x="0" y="0"/><a:chExt cx="${String(w)}" cy="${String(h)}"/></a:xfrm></p:grpSpPr></p:grpSp>`;
};

const normalizeColAlign = (align: string | undefined): string => {
  if (!align) return 'ctr';
  const map: Record<string, string> = {
    left: 'l',
    l: 'l',
    center: 'ctr',
    ctr: 'ctr',
    right: 'r',
    r: 'r',
  };
  return map[align] ?? 'ctr';
};

/** Normalize addShape rows to string[][]. */
export const normalizeTableRows = (raw: unknown): string[][] => {
  if (!Array.isArray(raw) || raw.length === 0) return [['']];
  return raw.map((row) =>
    Array.isArray(row) ? row.map((cell) => (typeof cell === 'string' ? cell : '')) : [''],
  );
};

/** Resolve columnWidths to EMU array; normalizes if sum ≠ table width. */
export function resolveColumnWidthsEmu(
  raw: unknown,
  cols: number,
  tableWidthEmu: number,
): { widths: number[]; normalized: boolean } {
  const equal = Math.floor(tableWidthEmu / Math.max(1, cols));
  if (!Array.isArray(raw) || raw.length === 0) {
    const widths = Array.from({ length: cols }, () => equal);
    // Fix rounding so sum equals table width.
    if (widths.length > 0) {
      const sum = widths.reduce((a, b) => a + b, 0);
      widths[widths.length - 1]! += tableWidthEmu - sum;
    }
    return { widths, normalized: false };
  }
  const widths: number[] = [];
  for (let i = 0; i < cols; i++) {
    const entry = raw[i];
    if (entry === undefined) {
      widths.push(equal);
      continue;
    }
    if (typeof entry === 'string' && entry.trim().endsWith('%')) {
      const pct = Number(entry.trim().replace(/%$/, ''));
      if (!Number.isFinite(pct)) throw new Error(`Invalid columnWidths[%]: ${entry}`);
      widths.push(Math.round((pct / 100) * tableWidthEmu));
    } else if (typeof entry === 'number' || typeof entry === 'string') {
      widths.push(parseLength(entry as LengthInput, { axis: 'x' }));
    } else {
      throw new Error('columnWidths entries must be lengths or percentages');
    }
  }
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('columnWidths sum must be positive');
  if (sum !== tableWidthEmu) {
    const scaled = widths.map((w) => Math.max(1, Math.round((w / sum) * tableWidthEmu)));
    const scaledSum = scaled.reduce((a, b) => a + b, 0);
    scaled[scaled.length - 1]! += tableWidthEmu - scaledSum;
    return { widths: scaled, normalized: true };
  }
  return { widths, normalized: false };
}

/** Parse "r:c" merge coordinate. */
export const parseMergeCoord = (value: string): { row: number; col: number } => {
  const match = /^(\d+):(\d+)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid merge coordinate "${value}"; expected "row:col"`);
  return { row: Number(match[1]), col: Number(match[2]) };
};

type MergeSpan = { gridSpan?: number; rowSpan?: number; hMerge?: boolean; vMerge?: boolean };

/** Build per-cell merge attributes from merges:[{from,to}]. */
export function buildMergeMap(merges: unknown, rows: number, cols: number): Map<string, MergeSpan> {
  const map = new Map<string, MergeSpan>();
  if (!Array.isArray(merges)) return map;
  for (const entry of merges) {
    if (typeof entry !== 'object' || entry === null) continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec['from'] !== 'string' || typeof rec['to'] !== 'string') continue;
    const from = parseMergeCoord(rec['from']);
    const to = parseMergeCoord(rec['to']);
    if (from.row > to.row || from.col > to.col)
      throw new Error(`Invalid merge range ${rec['from']}→${rec['to']}`);
    if (to.row >= rows || to.col >= cols)
      throw new Error(`Merge ${rec['from']}→${rec['to']} out of table bounds`);
    const gridSpan = to.col - from.col + 1;
    const rowSpan = to.row - from.row + 1;
    for (let r = from.row; r <= to.row; r++) {
      for (let c = from.col; c <= to.col; c++) {
        const key = `${r}:${c}`;
        if (r === from.row && c === from.col) {
          map.set(key, {
            ...(gridSpan > 1 ? { gridSpan } : {}),
            ...(rowSpan > 1 ? { rowSpan } : {}),
          });
        } else if (r === from.row && c > from.col) {
          map.set(key, { hMerge: true });
        } else if (c === from.col && r > from.row) {
          map.set(key, { vMerge: true });
        } else {
          // Covered by both — OOXML uses hMerge for horizontal continuation of vMerge rows.
          map.set(key, { hMerge: true });
        }
      }
    }
  }
  return map;
}

export function resolveTableFrame(
  e: Record<string, unknown>,
  archive?: OpcArchive,
): TableFrameLayout {
  const rows = normalizeTableRows(e['rows']);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const width = resolveEmu(e['width'], 914400 * cols, 'x', archive);
  const fontPt = typeof e['fontSize'] === 'number' ? e['fontSize'] : 11;
  const { widths } = resolveColumnWidthsEmu(e['columnWidths'], cols, width);
  const measured = measureTableLayout({
    rows,
    widthEmu: width,
    fontPt,
    colWidthsEmu: widths,
  });
  const heightRaw = e['height'];
  return layoutTableFrame({
    contentRowHeightsEmu: measured.rowHeightsEmu,
    contentEmu: measured.totalHeightEmu,
    ...(heightRaw === 'auto' || heightRaw === undefined
      ? {}
      : { frameEmu: resolveEmu(heightRaw, measured.totalHeightEmu, 'y', archive) }),
  });
}

const tableXml = (id: number, e: Record<string, unknown>, archive?: OpcArchive) => {
  const rows = normalizeTableRows(e['rows']);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const width = resolveEmu(e['width'], 914400 * cols, 'x', archive);
  const fontPt = typeof e['fontSize'] === 'number' ? e['fontSize'] : 11;
  const fontFamily = typeof e['fontFamily'] === 'string' ? e['fontFamily'] : undefined;
  const { widths: colWidths } = resolveColumnWidthsEmu(e['columnWidths'], cols, width);
  const frame = resolveTableFrame(e, archive);
  const theme = typeof e['theme'] === 'string' ? e['theme'] : 'minimal';
  const alignColumns = Array.isArray(e['alignColumns']) ? (e['alignColumns'] as string[]) : [];
  const mergeMap = buildMergeMap(e['merges'], rows.length, cols);
  const height = frame.frameEmu;
  const sized = { ...e, width, height };
  const hasCjk = (text: string) => /[\u3400-\u9FFF\uF900-\uFAFF]/.test(text);
  const cellXml = (text: string, header: boolean, colIndex: number, rowIndex: number) => {
    const mergeKey = `${rowIndex}:${colIndex}`;
    const merge = mergeMap.get(mergeKey);
    if (merge?.hMerge || merge?.vMerge) {
      const attrs = [merge.hMerge ? 'hMerge="1"' : '', merge.vMerge ? 'vMerge="1"' : '']
        .filter(Boolean)
        .join(' ');
      return `<a:tc${attrs ? ` ${attrs}` : ''}><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr/></a:tc>`;
    }
    let fill = 'FFFFFF';
    let color = '1A1A1A';
    let bold = '';
    if (theme === 'zebra') {
      if (header) {
        fill = '1B4F72';
        color = 'FFFFFF';
        bold = ' b="1"';
      } else {
        fill = rowIndex % 2 === 1 ? 'F2F4F7' : 'FFFFFF';
      }
    } else if (header) {
      fill = 'F7F7F7';
      color = '1A1A1A';
      bold = ' b="1"';
    }
    const algn = normalizeColAlign(alignColumns[colIndex]);
    const border = (side: string) =>
      `<a:${side} w="6350"><a:solidFill><a:srgbClr val="D0D0D0"/></a:solidFill></a:${side}>`;
    const lang = hasCjk(text) ? 'zh-CN' : 'en-US';
    const sz = String(Math.round(fontPt * 100));
    const typeface =
      fontFamily !== undefined
        ? `<a:latin typeface="${esc(fontFamily)}"/><a:ea typeface="${esc(fontFamily)}"/>`
        : '';
    const spanAttrs = [
      merge?.gridSpan !== undefined ? `gridSpan="${String(merge.gridSpan)}"` : '',
      merge?.rowSpan !== undefined ? `rowSpan="${String(merge.rowSpan)}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<a:tc${spanAttrs ? ` ${spanAttrs}` : ''}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${algn}"/><a:r><a:rPr lang="${lang}" sz="${sz}"${bold}>${typeface}<a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></a:txBody><a:tcPr>${border('lnL')}${border('lnR')}${border('lnT')}${border('lnB')}<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`;
  };
  const body = rows
    .map((row, rowIndex) => {
      const rowH = frame.rowHeightsEmu[rowIndex] ?? estimateTableRowHeightEmu(fontPt);
      return `<a:tr h="${String(rowH)}">${Array.from({ length: cols }, (_, i) =>
        cellXml(typeof row[i] === 'string' ? row[i]! : '', rowIndex === 0, i, rowIndex),
      ).join('')}</a:tr>`;
    })
    .join('');
  const grid = colWidths.map((w) => `<a:gridCol w="${String(w)}"/>`).join('');
  return `<p:graphicFrame xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvGraphicFramePr><p:cNvPr id="${String(id)}" name="${esc(value(e, 'name', `Table ${String(id)}`))}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${graphicFrameXfrm(sized, archive)}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${grid}</a:tblGrid>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
};
async function pictureXml(
  archive: OpcArchive,
  slidePart: string,
  id: number,
  e: Record<string, unknown>,
): Promise<string> {
  const added = await addPicturePart(archive, slidePart, {
    ...(typeof e['path'] === 'string' ? { path: e['path'] } : {}),
    ...(typeof e['base64'] === 'string' ? { base64: e['base64'] } : {}),
  });
  if (!added.ok) throw new Error(added.error.message);
  const rid = added.value.rid;
  return `<p:pic xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:nvPicPr><p:cNvPr id="${String(id)}" name="${esc(value(e, 'name', `Picture ${String(id)}`))}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(e, archive)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function chartXml(
  archive: OpcArchive,
  slidePart: string,
  id: number,
  e: Record<string, unknown>,
): string {
  const chartType = value(e, 'chartType', 'column') as ChartType;
  const data = (e['data'] ?? {}) as {
    title?: string;
    categories?: string[];
    series?: {
      name: string;
      values: number[];
      color?: string;
      axis?: 'primary' | 'secondary';
      chart?: 'bar' | 'column' | 'line';
    }[];
  };
  const series = Array.isArray(data.series) ? data.series : [];
  if (series.length === 0) throw new Error('Chart requires data.series with at least one series');
  const legend =
    e['legend'] === false || e['legend'] === true || typeof e['legend'] === 'string'
      ? (e['legend'] as boolean | 'b' | 't' | 'r' | 'l')
      : undefined;
  const valueAxis =
    typeof e['valueAxis'] === 'object' && e['valueAxis'] !== null
      ? (e['valueAxis'] as { visible?: boolean; min?: number; max?: number })
      : undefined;
  const categoryAxis =
    typeof e['categoryAxis'] === 'object' && e['categoryAxis'] !== null
      ? (e['categoryAxis'] as { visible?: boolean })
      : undefined;
  const fontSize = typeof e['fontSize'] === 'number' ? e['fontSize'] : undefined;
  const created = createChartPart(archive, slidePart, {
    chartType,
    ...(typeof data.title === 'string' ? { title: data.title } : {}),
    categories: Array.isArray(data.categories) ? data.categories : [],
    series,
    ...(typeof e['showDataLabels'] === 'boolean' ? { showDataLabels: e['showDataLabels'] } : {}),
    ...(legend !== undefined ? { legend } : {}),
    ...(valueAxis !== undefined ? { valueAxis } : {}),
    ...(categoryAxis !== undefined ? { categoryAxis } : {}),
    ...(fontSize !== undefined ? { fontSize } : {}),
  });
  const width = resolveEmu(e['width'], 914400 * 4, 'x', archive);
  const height = resolveEmu(e['height'], 914400 * 3, 'y', archive);
  return chartGraphicFrameXml(id, created.rid, { ...e, width, height });
}

async function avMediaXml(
  archive: OpcArchive,
  slidePart: string,
  id: number,
  e: Record<string, unknown>,
  kind: 'video' | 'audio',
): Promise<string> {
  const path = typeof e['path'] === 'string' ? e['path'] : undefined;
  if (!path) throw new Error(`${kind} requires path`);
  const added = await addMediaPart(archive, slidePart, { path, kind });
  if (!added.ok) throw new Error(added.error.message);
  return mediaPicXml(
    id,
    {
      ...e,
      x: resolveEmu(e['x'], 0, 'x', archive),
      y: resolveEmu(e['y'], 0, 'y', archive),
      width: resolveEmu(e['width'], 914400, 'x', archive),
      height: resolveEmu(e['height'], 914400, 'y', archive),
    },
    kind,
    added.value.fileRid,
    added.value.mediaRid,
    added.value.posterRid,
  );
}

export async function addElement(
  archive: OpcArchive,
  slidePart: string,
  doc: Document,
  parent: Element,
  e: Record<string, unknown>,
): Promise<Element> {
  const kind = value(e, 'kind', value(e, 'type', 'textbox')),
    id = nextShapeId(doc);
  let xml: string;
  if (kind === 'connector') xml = connectorXml(id, e, archive);
  else if (kind === 'group') xml = groupXml(id, e, archive);
  else if (kind === 'table') xml = tableXml(id, e, archive);
  else if (kind === 'picture') xml = await pictureXml(archive, slidePart, id, e);
  else if (kind === 'chart') xml = chartXml(archive, slidePart, id, e);
  else if (kind === 'video') xml = await avMediaXml(archive, slidePart, id, e, 'video');
  else if (kind === 'audio') xml = await avMediaXml(archive, slidePart, id, e, 'audio');
  else xml = shapeXml(id, e, archive);
  const node = parseXml(xml).documentElement,
    imported = doc.importNode(node, true);
  parent.appendChild(imported);
  return imported;
}
export const duplicateElement = (doc: Document, node: Element): Element => {
  const clone = node.cloneNode(true) as Element;
  allocateShapeIds(doc, clone);
  node.parentNode?.appendChild(clone);
  return clone;
};
export function updateChart(
  archive: OpcArchive,
  part: string,
  properties: Record<string, unknown>,
): { workbook: boolean } {
  const chart = archive.readXml(part);
  applyChartProperties(chart, properties);
  archive.writeXml(part, chart);
  return { workbook: archive.getRelationships(part).some((r) => r.type === REL.package) };
}

export function setColor(node: Element, from: string, to: string): number {
  let changed = 0;
  for (const color of descendants(node, 'srgbClr'))
    if (!from || attr(color, 'val')?.toLowerCase() === from.toLowerCase()) {
      color.setAttribute('val', to.replace(/^#/, '').toUpperCase());
      changed++;
    }
  return changed;
}
