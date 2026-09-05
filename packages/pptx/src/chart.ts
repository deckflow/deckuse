import { posix } from 'node:path';
import type { OpcArchive, OpcRelationship } from '@deckflow/deckuse-opc';
import type { Document, Element } from '@xmldom/xmldom';
import { NS, REL, children, descendants, first, setNodeText } from './xml.js';

const CHART_CT = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';

/** Default series fills — readable on both light and dark slide backgrounds. */
export const DEFAULT_SERIES_COLORS = [
  '5B8DEF',
  'F0A500',
  '2ECC71',
  'E74C3C',
  '9B59B6',
  '1ABC9C',
] as const;

export type ChartType = 'bar' | 'column' | 'line' | 'pie';

export interface ChartSeriesInput {
  name: string;
  values: number[];
  /** Optional `#RRGGBB` or `RRGGBB` series fill. */
  color?: string;
}

export interface ChartCreateInput {
  chartType: ChartType;
  title?: string;
  categories: string[];
  series: ChartSeriesInput[];
}

const esc = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

export const normalizeHexColor = (value: string): string => {
  const hex = value.trim().replace(/^#/, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(hex)) throw new Error(`Invalid color: ${value}`);
  return hex;
};

const nextChartPart = (archive: OpcArchive): string => {
  let n = 1;
  while (archive.getPart(`/ppt/charts/chart${String(n)}.xml`)) n++;
  return `/ppt/charts/chart${String(n)}.xml`;
};

const nextRid = (rels: readonly OpcRelationship[]) => {
  let n = 1;
  const ids = new Set(rels.map((r) => r.id));
  while (ids.has(`rId${String(n)}`)) n++;
  return `rId${String(n)}`;
};

const relativeTarget = (source: string, target: string): string =>
  posix.relative(posix.dirname(source), target).replace(/^\//, '');

const directChild = (node: Element, localName: string): Element | undefined =>
  children(node).find((child) => child.localName === localName);

/** Literal string points for c:strLit (not nested c:strCache — that belongs under c:strRef). */
const strLitPoints = (values: string[]) =>
  `<c:ptCount val="${String(values.length)}"/>${values
    .map((v, i) => `<c:pt idx="${String(i)}"><c:v>${esc(v)}</c:v></c:pt>`)
    .join('')}`;

/** Literal number points for c:numLit (not nested c:numCache — that belongs under c:numRef). */
const numLitPoints = (values: number[]) =>
  `<c:formatCode>General</c:formatCode><c:ptCount val="${String(values.length)}"/>${values
    .map((v, i) => `<c:pt idx="${String(i)}"><c:v>${String(v)}</c:v></c:pt>`)
    .join('')}`;

const seriesSpPrXml = (color: string) =>
  `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>`;

const seriesXml = (series: ChartSeriesInput[], categories: string[]) =>
  series
    .map((ser, index) => {
      const cats =
        categories.length > 0
          ? `<c:cat><c:strLit>${strLitPoints(categories)}</c:strLit></c:cat>`
          : '';
      const vals = `<c:val><c:numLit>${numLitPoints(ser.values)}</c:numLit></c:val>`;
      const tx = `<c:tx><c:v>${esc(ser.name)}</c:v></c:tx>`;
      const color = ser.color
        ? normalizeHexColor(ser.color)
        : DEFAULT_SERIES_COLORS[index % DEFAULT_SERIES_COLORS.length]!;
      return `<c:ser><c:idx val="${String(index)}"/><c:order val="${String(index)}"/>${tx}${seriesSpPrXml(color)}${cats}${vals}</c:ser>`;
    })
    .join('');

const plotXml = (chartType: ChartType, series: ChartSeriesInput[], categories: string[]) => {
  const ser = seriesXml(series, categories);
  if (chartType === 'pie') {
    return `<c:pieChart><c:varyColors val="1"/>${ser}<c:dLbls><c:showPercent val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/></c:dLbls></c:pieChart>`;
  }
  if (chartType === 'line') {
    return `<c:lineChart><c:grouping val="standard"/>${ser}<c:marker val="1"/><c:axId val="1"/><c:axId val="2"/></c:lineChart>`;
  }
  const barDir = chartType === 'bar' ? 'bar' : 'col';
  // gapWidth 100 ≈ clearer clustered grouping than OOXML default 150.
  return `<c:barChart><c:barDir val="${barDir}"/><c:grouping val="clustered"/><c:gapWidth val="100"/>${ser}<c:overlap val="0"/><c:axId val="1"/><c:axId val="2"/></c:barChart>`;
};

const axesXml = (chartType: ChartType) => {
  if (chartType === 'pie') return '';
  return `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/><c:tickLblPos val="nextTo"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/><c:tickLblPos val="nextTo"/></c:valAx>`;
};

const titleXml = (title?: string) => {
  if (!title) return '<c:autoTitleDeleted val="1"/>';
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`;
};

export function buildChartXml(input: ChartCreateInput): string {
  const categories = input.categories;
  const series = input.series;
  const legend =
    input.chartType === 'pie' ? '' : '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:chart>${titleXml(input.title)}<c:plotArea><c:layout/>${plotXml(input.chartType, series, categories)}${axesXml(input.chartType)}</c:plotArea>${legend}<c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
}

export function createChartPart(
  archive: OpcArchive,
  slidePart: string,
  input: ChartCreateInput,
): { chartPart: string; rid: string } {
  const chartPart = nextChartPart(archive);
  const xml = buildChartXml(input);
  archive.setPart(chartPart, new TextEncoder().encode(xml), CHART_CT);
  const rels = [...archive.getRelationships(slidePart)];
  const rid = nextRid(rels);
  rels.push({
    id: rid,
    type: REL.chart,
    target: relativeTarget(slidePart, chartPart),
    external: false,
    resolvedTarget: chartPart,
  });
  archive.setRelationships(slidePart, rels);
  return { chartPart, rid };
}

export const chartGraphicFrameXml = (
  id: number,
  rid: string,
  e: Record<string, unknown>,
): string => {
  const name =
    typeof e['name'] === 'string' && e['name'].length > 0 ? e['name'] : `Chart ${String(id)}`;
  const x = typeof e['x'] === 'number' ? e['x'] : 0;
  const y = typeof e['y'] === 'number' ? e['y'] : 0;
  const width = typeof e['width'] === 'number' ? e['width'] : 914400 * 4;
  const height = typeof e['height'] === 'number' ? e['height'] : 914400 * 3;
  return `<p:graphicFrame xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:c="${NS.c}"><p:nvGraphicFramePr><p:cNvPr id="${String(id)}" name="${esc(name)}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${String(x)}" y="${String(y)}"/><a:ext cx="${String(width)}" cy="${String(height)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="${NS.c}" xmlns:r="${NS.r}" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
};

const ensureChild = (
  parent: Element,
  localName: string,
  ns: string,
  qualified: string,
  afterLocalNames: readonly string[] = [],
): Element => {
  const existing = directChild(parent, localName);
  if (existing) return existing;
  const doc = parent.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  const created = doc.createElementNS(ns, qualified);
  const kids = children(parent);
  let anchor: Element | undefined;
  for (const child of kids)
    if (child.localName && afterLocalNames.includes(child.localName)) anchor = child;
  if (anchor?.nextSibling) parent.insertBefore(created, anchor.nextSibling);
  else if (anchor) parent.appendChild(created);
  else parent.appendChild(created);
  return created;
};

const setSolidOnRPr = (rPr: Element, color: string): void => {
  const doc = rPr.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  for (const child of [...children(rPr)])
    if (child.localName === 'solidFill' || child.localName === 'schemeClr') rPr.removeChild(child);
  const solid = doc.createElementNS(NS.a, 'a:solidFill');
  const srgb = doc.createElementNS(NS.a, 'a:srgbClr');
  srgb.setAttribute('val', color);
  solid.appendChild(srgb);
  if (rPr.firstChild) rPr.insertBefore(solid, rPr.firstChild);
  else rPr.appendChild(solid);
};

const buildTxPr = (doc: Document, color: string): Element => {
  const txPr = doc.createElementNS(NS.c, 'c:txPr');
  const bodyPr = doc.createElementNS(NS.a, 'a:bodyPr');
  const lstStyle = doc.createElementNS(NS.a, 'a:lstStyle');
  const p = doc.createElementNS(NS.a, 'a:p');
  const pPr = doc.createElementNS(NS.a, 'a:pPr');
  const defRPr = doc.createElementNS(NS.a, 'a:defRPr');
  defRPr.setAttribute('sz', '1100');
  setSolidOnRPr(defRPr, color);
  pPr.appendChild(defRPr);
  p.appendChild(pPr);
  const end = doc.createElementNS(NS.a, 'a:endParaRPr');
  end.setAttribute('sz', '1100');
  setSolidOnRPr(end, color);
  p.appendChild(end);
  txPr.appendChild(bodyPr);
  txPr.appendChild(lstStyle);
  txPr.appendChild(p);
  return txPr;
};

/** Apply text color to title runs, legend, and axis tick labels. */
export function applyChartTextColor(chartDoc: Document, colorInput: string): void {
  const color = normalizeHexColor(colorInput);
  const title = first(chartDoc, 'title');
  if (title) {
    for (const rPr of descendants(title, 'rPr')) setSolidOnRPr(rPr, color);
    for (const defRPr of descendants(title, 'defRPr')) setSolidOnRPr(defRPr, color);
  }
  const doc = chartDoc;
  for (const local of ['legend', 'catAx', 'valAx'] as const) {
    for (const node of descendants(chartDoc, local)) {
      const existing = directChild(node, 'txPr');
      if (existing) existing.parentNode?.removeChild(existing);
      const txPr = buildTxPr(doc, color);
      // Place txPr near the end of axis/legend (after tickLblPos / overlay when present).
      node.appendChild(txPr);
    }
  }
}

export function applyChartGapWidth(chartDoc: Document, gapWidth: number): void {
  if (!Number.isFinite(gapWidth) || gapWidth < 0)
    throw new Error(`gapWidth must be a non-negative number, got ${String(gapWidth)}`);
  const val = String(Math.round(gapWidth));
  for (const plot of [...descendants(chartDoc, 'barChart'), ...descendants(chartDoc, 'lineChart')]) {
    const gap = ensureChild(plot, 'gapWidth', NS.c, 'c:gapWidth', ['barDir', 'grouping']);
    gap.setAttribute('val', val);
  }
}

export function applyChartBackground(chartDoc: Document, colorInput: string): void {
  const color = normalizeHexColor(colorInput);
  const root = chartDoc.documentElement;
  if (!root) throw new Error('Chart XML has no root');
  let spPr = directChild(root, 'spPr');
  if (!spPr) {
    spPr = chartDoc.createElementNS(NS.c, 'c:spPr');
    // chartSpace children order: date1904?, lang?, roundedCorners?, style?, colorStyle?,
    // clrMapOvr?, pivotSource?, protection?, chart, spPr, txPr, externalData, ...
    const chart = directChild(root, 'chart');
    if (chart?.nextSibling) root.insertBefore(spPr, chart.nextSibling);
    else if (chart) root.appendChild(spPr);
    else root.appendChild(spPr);
  }
  for (const child of [...children(spPr)])
    if (
      child.localName === 'solidFill' ||
      child.localName === 'gradFill' ||
      child.localName === 'noFill' ||
      child.localName === 'pattFill'
    )
      spPr.removeChild(child);
  const solid = chartDoc.createElementNS(NS.a, 'a:solidFill');
  const srgb = chartDoc.createElementNS(NS.a, 'a:srgbClr');
  srgb.setAttribute('val', color);
  solid.appendChild(srgb);
  if (spPr.firstChild) spPr.insertBefore(solid, spPr.firstChild);
  else spPr.appendChild(solid);
}

export function applyChartMajorGridlines(chartDoc: Document, show: boolean, color = 'FFFFFF'): void {
  const line = normalizeHexColor(color.startsWith('#') ? color : `#${color}`);
  for (const ax of descendants(chartDoc, 'valAx')) {
    const existing = directChild(ax, 'majorGridlines');
    if (show) {
      if (existing) existing.parentNode?.removeChild(existing);
      const grid = chartDoc.createElementNS(NS.c, 'c:majorGridlines');
      const spPr = chartDoc.createElementNS(NS.c, 'c:spPr');
      const ln = chartDoc.createElementNS(NS.a, 'a:ln');
      ln.setAttribute('w', '6350');
      const solid = chartDoc.createElementNS(NS.a, 'a:solidFill');
      const srgb = chartDoc.createElementNS(NS.a, 'a:srgbClr');
      srgb.setAttribute('val', line);
      const alpha = chartDoc.createElementNS(NS.a, 'a:alpha');
      alpha.setAttribute('val', line === 'FFFFFF' ? '25000' : '35000');
      srgb.appendChild(alpha);
      solid.appendChild(srgb);
      ln.appendChild(solid);
      spPr.appendChild(ln);
      grid.appendChild(spPr);
      const after = directChild(ax, 'axPos') ?? directChild(ax, 'delete');
      if (after?.nextSibling) ax.insertBefore(grid, after.nextSibling);
      else if (after) ax.appendChild(grid);
      else ax.appendChild(grid);
    } else if (existing) {
      existing.parentNode?.removeChild(existing);
    }
  }
}

const valueCache = (ser: Element): Element | undefined => {
  const val = directChild(ser, 'val') ?? first(ser, 'val');
  if (!val) return undefined;
  return (
    directChild(val, 'numLit') ??
    first(val, 'numLit') ??
    directChild(val, 'numCache') ??
    first(val, 'numCache')
  );
};

const setSeriesColor = (ser: Element, colorInput: string): void => {
  const color = normalizeHexColor(colorInput);
  const doc = ser.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  let spPr = directChild(ser, 'spPr');
  if (!spPr) {
    spPr = doc.createElementNS(NS.c, 'c:spPr');
    const after = directChild(ser, 'tx') ?? directChild(ser, 'order') ?? directChild(ser, 'idx');
    if (after?.nextSibling) ser.insertBefore(spPr, after.nextSibling);
    else if (after) ser.appendChild(spPr);
    else ser.appendChild(spPr);
  }
  for (const child of [...children(spPr)])
    if (
      child.localName === 'solidFill' ||
      child.localName === 'gradFill' ||
      child.localName === 'noFill' ||
      child.localName === 'pattFill'
    )
      spPr.removeChild(child);
  const solid = doc.createElementNS(NS.a, 'a:solidFill');
  const srgb = doc.createElementNS(NS.a, 'a:srgbClr');
  srgb.setAttribute('val', color);
  solid.appendChild(srgb);
  if (spPr.firstChild) spPr.insertBefore(solid, spPr.firstChild);
  else spPr.appendChild(solid);
  if (!directChild(spPr, 'ln')) {
    const ln = doc.createElementNS(NS.a, 'a:ln');
    ln.appendChild(doc.createElementNS(NS.a, 'a:noFill'));
    spPr.appendChild(ln);
  }
};

const setSeriesValues = (ser: Element, values: unknown[]): void => {
  const cache = valueCache(ser);
  if (!cache) return;
  const doc = ser.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  const pts = children(cache).filter((c) => c.localName === 'pt');
  values.forEach((entry, i) => {
    let pt = pts[i];
    if (!pt) {
      pt = doc.createElementNS(NS.c, 'c:pt');
      pt.setAttribute('idx', String(i));
      const v = doc.createElementNS(NS.c, 'c:v');
      v.appendChild(doc.createTextNode(String(entry)));
      pt.appendChild(v);
      cache.appendChild(pt);
    } else {
      const v = directChild(pt, 'v') ?? first(pt, 'v');
      if (v) v.textContent = String(entry);
    }
  });
  // Drop trailing points if the series shrank.
  for (const extra of pts.slice(values.length)) extra.parentNode?.removeChild(extra);
  const count = directChild(cache, 'ptCount') ?? first(cache, 'ptCount');
  if (count) count.setAttribute('val', String(values.length));
};

export function readSeriesColor(ser: Element): string | undefined {
  const spPr = directChild(ser, 'spPr');
  if (!spPr) return undefined;
  const srgb = first(spPr, 'srgbClr');
  const val = srgb?.getAttribute('val');
  return val ? `#${val.toUpperCase()}` : undefined;
}

/** Mutate an existing chart part from semantic chart properties. */
export function applyChartProperties(
  chartDoc: Document,
  properties: Record<string, unknown>,
): void {
  if (typeof properties['title'] === 'string')
    setNodeText(
      first(chartDoc, 'title') ??
        (() => {
          if (!chartDoc.documentElement) throw new Error('Chart XML has no root');
          return chartDoc.documentElement;
        })(),
      properties['title'],
    );

  const series = properties['series'];
  if (Array.isArray(series))
    series.forEach((input, index) => {
      if (typeof input !== 'object' || input === null) return;
      const spec = input as Record<string, unknown>;
      const node = descendants(chartDoc, 'ser')[index];
      if (!node) return;
      if (typeof spec['name'] === 'string') {
        const tx = first(node, 'tx');
        if (tx) {
          const v = first(tx, 'v');
          if (v) v.textContent = spec['name'];
          else setNodeText(tx, spec['name']);
        }
      }
      if (Array.isArray(spec['values'])) setSeriesValues(node, spec['values']);
      if (typeof spec['color'] === 'string') setSeriesColor(node, spec['color']);
    });

  const textColor =
    typeof properties['textColor'] === 'string'
      ? properties['textColor']
      : typeof properties['fontColor'] === 'string'
        ? properties['fontColor']
        : undefined;
  if (typeof textColor === 'string') applyChartTextColor(chartDoc, textColor);

  if (typeof properties['gapWidth'] === 'number') applyChartGapWidth(chartDoc, properties['gapWidth']);

  const fill =
    typeof properties['fill'] === 'string'
      ? properties['fill']
      : typeof properties['background'] === 'string'
        ? properties['background']
        : undefined;
  if (typeof fill === 'string') applyChartBackground(chartDoc, fill);

  if (typeof properties['showMajorGridlines'] === 'boolean') {
    const gridColor =
      typeof properties['gridlineColor'] === 'string'
        ? properties['gridlineColor']
        : typeof fill === 'string'
          ? '8893A8'
          : 'FFFFFF';
    applyChartMajorGridlines(chartDoc, properties['showMajorGridlines'], gridColor);
  }
}
