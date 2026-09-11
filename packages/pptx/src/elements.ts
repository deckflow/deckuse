import { OpcArchive, parseXml } from '@deckflow/deckuse-opc';
import type { Document, Element } from '@xmldom/xmldom';
import { EMU_PER_PT, parseLength, type LengthInput } from '@deckflow/deckuse-core';
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
  NS,
  REL,
  allocateShapeIds,
  attr,
  descendants,
  nextShapeId,
} from './xml.js';
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
const textBody = (text: string) => {
  const lines = text.split('\n');
  return `<p:txBody><a:bodyPr/><a:lstStyle/>${lines
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
const shapeXml = (id: number, e: Record<string, unknown>, archive?: OpcArchive) =>
  `<p:sp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvSpPr><p:cNvPr id="${String(id)}" name="${esc(value(e, 'name', `Shape ${String(id)}`))}"/><p:cNvSpPr txBox="1"/>${nvPrXml(e)}</p:nvSpPr><p:spPr>${xfrm(e, archive)}<a:prstGeom prst="${esc(value(e, 'preset', 'rect'))}"><a:avLst/></a:prstGeom></p:spPr>${textBody(value(e, 'text', ''))}</p:sp>`;
const connectorXml = (id: number, e: Record<string, unknown>, archive?: OpcArchive) =>
  `<p:cxnSp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvCxnSpPr><p:cNvPr id="${String(id)}" name="${esc(value(e, 'name', `Connector ${String(id)}`))}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(e, archive)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom></p:spPr></p:cxnSp>`;
const groupXml = (id: number, e: Record<string, unknown>, archive?: OpcArchive) => {
  const w = resolveEmu(e['width'], 914400, 'x', archive);
  const h = resolveEmu(e['height'], 914400, 'y', archive);
  return `<p:grpSp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvGrpSpPr><p:cNvPr id="${String(id)}" name="${esc(value(e, 'name', `Group ${String(id)}`))}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${String(resolveEmu(e['x'], 0, 'x', archive))}" y="${String(resolveEmu(e['y'], 0, 'y', archive))}"/><a:ext cx="${String(w)}" cy="${String(h)}"/><a:chOff x="0" y="0"/><a:chExt cx="${String(w)}" cy="${String(h)}"/></a:xfrm></p:grpSpPr></p:grpSp>`;
};

/** Heuristic row height: ~1.65× body font (default 11pt). */
export const estimateTableRowHeightEmu = (fontPt = 11): number =>
  Math.round(fontPt * EMU_PER_PT * 1.65);

export const estimateTableHeightEmu = (rowCount: number, fontPt = 11): number =>
  Math.max(1, rowCount) * estimateTableRowHeightEmu(fontPt);

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

const tableXml = (id: number, e: Record<string, unknown>, archive?: OpcArchive) => {
  const rows = Array.isArray(e['rows']) ? (e['rows'] as unknown[][]) : [['']];
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const width = resolveEmu(e['width'], 914400 * cols, 'x', archive);
  const colW = String(Math.floor(width / cols));
  const rowH = estimateTableRowHeightEmu(11);
  const heightRaw = e['height'];
  const height =
    heightRaw === 'auto' || heightRaw === undefined
      ? estimateTableHeightEmu(rows.length)
      : resolveEmu(heightRaw, estimateTableHeightEmu(rows.length), 'y', archive);
  const theme = typeof e['theme'] === 'string' ? e['theme'] : 'minimal';
  const alignColumns = Array.isArray(e['alignColumns'])
    ? (e['alignColumns'] as string[])
    : [];
  const sized = { ...e, width, height };
  const cellXml = (text: string, header: boolean, colIndex: number, rowIndex: number) => {
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
    } else {
      // minimal
      if (header) {
        fill = 'F7F7F7';
        color = '1A1A1A';
        bold = ' b="1"';
      }
    }
    const algn = normalizeColAlign(alignColumns[colIndex]);
    const border = (side: string) =>
      `<a:${side} w="6350"><a:solidFill><a:srgbClr val="D0D0D0"/></a:solidFill></a:${side}>`;
    return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${algn}"/><a:r><a:rPr lang="zh-CN" sz="1100"${bold}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></a:txBody><a:tcPr>${border('lnL')}${border('lnR')}${border('lnT')}${border('lnB')}<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`;
  };
  return `<p:graphicFrame xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvGraphicFramePr><p:cNvPr id="${String(id)}" name="${esc(value(e, 'name', `Table ${String(id)}`))}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${graphicFrameXfrm(sized, archive)}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${Array.from({ length: cols }, () => `<a:gridCol w="${colW}"/>`).join('')}</a:tblGrid>${rows.map((row, rowIndex) => `<a:tr h="${String(rowH)}">${Array.from({ length: cols }, (_, i) => cellXml(typeof row[i] === 'string' ? row[i] : '', rowIndex === 0, i, rowIndex)).join('')}</a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
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
  const created = createChartPart(archive, slidePart, {
    chartType,
    ...(typeof data.title === 'string' ? { title: data.title } : {}),
    categories: Array.isArray(data.categories) ? data.categories : [],
    series,
    ...(typeof e['showDataLabels'] === 'boolean' ? { showDataLabels: e['showDataLabels'] } : {}),
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
