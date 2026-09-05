import { OpcArchive, parseXml } from '@deckflow/deckuse-opc';
import type { Document, Element } from '@xmldom/xmldom';
import { chartGraphicFrameXml, createChartPart, type ChartType } from './chart.js';
import { addMediaPart, mediaPicXml } from './media.js';
import { addPicturePart } from './picture.js';
import {
  NS,
  REL,
  allocateShapeIds,
  attr,
  descendants,
  first,
  nextShapeId,
  setNodeText,
} from './xml.js';
const esc = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const value = (obj: Record<string, unknown>, key: string, fallback: string): string =>
  typeof obj[key] === 'string' ? obj[key] : fallback;
const num = (obj: Record<string, unknown>, key: string, fallback: number): number =>
  typeof obj[key] === 'number' ? obj[key] : fallback;
const xfrm = (e: Record<string, unknown>) =>
  `<a:xfrm><a:off x="${String(num(e, 'x', 0))}" y="${String(num(e, 'y', 0))}"/><a:ext cx="${String(num(e, 'width', 914400))}" cy="${String(num(e, 'height', 914400))}"/></a:xfrm>`;
const textBody = (text: string) =>
  `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody>`;
const shapeXml = (id: number, e: Record<string, unknown>) =>
  `<p:sp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvSpPr><p:cNvPr id="${String(id)}" name="${esc(value(e, 'name', `Shape ${String(id)}`))}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(e)}<a:prstGeom prst="${esc(value(e, 'preset', 'rect'))}"><a:avLst/></a:prstGeom></p:spPr>${textBody(value(e, 'text', ''))}</p:sp>`;
const connectorXml = (id: number, e: Record<string, unknown>) =>
  `<p:cxnSp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvCxnSpPr><p:cNvPr id="${String(id)}" name="${esc(value(e, 'name', `Connector ${String(id)}`))}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(e)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom></p:spPr></p:cxnSp>`;
const groupXml = (id: number, e: Record<string, unknown>) =>
  `<p:grpSp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvGrpSpPr><p:cNvPr id="${String(id)}" name="${esc(value(e, 'name', `Group ${String(id)}`))}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${String(num(e, 'x', 0))}" y="${String(num(e, 'y', 0))}"/><a:ext cx="${String(num(e, 'width', 914400))}" cy="${String(num(e, 'height', 914400))}"/><a:chOff x="0" y="0"/><a:chExt cx="${String(num(e, 'width', 914400))}" cy="${String(num(e, 'height', 914400))}"/></a:xfrm></p:grpSpPr></p:grpSp>`;
const tableXml = (id: number, e: Record<string, unknown>) => {
  const rows = Array.isArray(e['rows']) ? (e['rows'] as unknown[][]) : [['']];
  const cols = Math.max(1, ...rows.map((r) => r.length));
  return `<p:graphicFrame xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvGraphicFramePr><p:cNvPr id="${String(id)}" name="${esc(value(e, 'name', `Table ${String(id)}`))}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${xfrm(e)}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${Array.from({ length: cols }, () => `<a:gridCol w="${String(Math.floor(num(e, 'width', 914400 * cols) / cols))}"/>`).join('')}</a:tblGrid>${rows.map((row) => `<a:tr h="370840">${Array.from({ length: cols }, (_, i) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${esc(typeof row[i] === 'string' ? row[i] : '')}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`).join('')}</a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
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
  return `<p:pic xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:nvPicPr><p:cNvPr id="${String(id)}" name="${esc(value(e, 'name', `Picture ${String(id)}`))}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(e)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
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
    series?: { name: string; values: number[] }[];
  };
  const series = Array.isArray(data.series) ? data.series : [];
  if (series.length === 0) throw new Error('Chart requires data.series with at least one series');
  const created = createChartPart(archive, slidePart, {
    chartType,
    ...(typeof data.title === 'string' ? { title: data.title } : {}),
    categories: Array.isArray(data.categories) ? data.categories : [],
    series,
  });
  return chartGraphicFrameXml(id, created.rid, e);
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
    e,
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
  if (kind === 'connector') xml = connectorXml(id, e);
  else if (kind === 'group') xml = groupXml(id, e);
  else if (kind === 'table') xml = tableXml(id, e);
  else if (kind === 'picture') xml = await pictureXml(archive, slidePart, id, e);
  else if (kind === 'chart') xml = chartXml(archive, slidePart, id, e);
  else if (kind === 'video') xml = await avMediaXml(archive, slidePart, id, e, 'video');
  else if (kind === 'audio') xml = await avMediaXml(archive, slidePart, id, e, 'audio');
  else xml = shapeXml(id, e);
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
  if (typeof properties['title'] === 'string')
    setNodeText(
      first(chart, 'title') ??
        (() => {
          if (!chart.documentElement) throw new Error('Chart XML has no root');
          return chart.documentElement;
        })(),
      properties['title'],
    );
  const series = properties['series'];
  if (Array.isArray(series))
    series.forEach((input, index) => {
      if (typeof input !== 'object' || input === null) return;
      const spec = input as Record<string, unknown>,
        node = descendants(chart, 'ser')[index];
      if (!node) return;
      if (typeof spec['name'] === 'string') {
        const tx = first(node, 'tx');
        if (tx) {
          const v = first(tx, 'v');
          if (v) v.textContent = spec['name'];
          else setNodeText(tx, spec['name']);
        }
      }
      if (Array.isArray(spec['values'])) {
        const values = spec['values'];
        const cache = first(first(node, 'val') ?? node, 'numCache');
        if (cache) {
          const points = descendants(cache, 'pt');
          values.forEach((entry, i) => {
            const v = first(points[i] ?? cache, 'v');
            if (v) v.textContent = String(entry);
          });
          const count = first(cache, 'ptCount');
          if (count) count.setAttribute('val', String(values.length));
        }
      }
    });
  archive.writeXml(part, chart, archive.getPart(part)?.mediaType);
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
