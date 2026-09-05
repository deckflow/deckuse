import { posix } from 'node:path';
import type { OpcArchive, OpcRelationship } from '@deckflow/deckuse-opc';
import { NS, REL } from './xml.js';

const CHART_CT = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';

export type ChartType = 'bar' | 'column' | 'line' | 'pie';

export interface ChartSeriesInput {
  name: string;
  values: number[];
}

export interface ChartCreateInput {
  chartType: ChartType;
  title?: string;
  categories: string[];
  series: ChartSeriesInput[];
}

const esc = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

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

const strCache = (values: string[]) =>
  `<c:strCache><c:ptCount val="${String(values.length)}"/>${values
    .map((v, i) => `<c:pt idx="${String(i)}"><c:v>${esc(v)}</c:v></c:pt>`)
    .join('')}</c:strCache>`;

const numCache = (values: number[]) =>
  `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${String(values.length)}"/>${values
    .map((v, i) => `<c:pt idx="${String(i)}"><c:v>${String(v)}</c:v></c:pt>`)
    .join('')}</c:numCache>`;

const seriesXml = (series: ChartSeriesInput[], categories: string[]) =>
  series
    .map((ser, index) => {
      const cats =
        categories.length > 0
          ? `<c:cat><c:strLit>${strCache(categories)}</c:strLit></c:cat>`
          : '';
      const vals = `<c:val><c:numLit>${numCache(ser.values)}</c:numLit></c:val>`;
      const tx = `<c:tx><c:v>${esc(ser.name)}</c:v></c:tx>`;
      return `<c:ser><c:idx val="${String(index)}"/><c:order val="${String(index)}"/>${tx}${cats}${vals}</c:ser>`;
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
  return `<c:barChart><c:barDir val="${barDir}"/><c:grouping val="clustered"/>${ser}<c:axId val="1"/><c:axId val="2"/></c:barChart>`;
};

const axesXml = (chartType: ChartType) => {
  if (chartType === 'pie') return '';
  return `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/><c:tickLblPos val="nextTo"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/><c:tickLblPos val="nextTo"/></c:valAx>`;
};

const titleXml = (title?: string) => {
  if (!title) return '<c:autoTitleDeleted val="1"/>';
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`;
};

export function buildChartXml(input: ChartCreateInput): string {
  const categories = input.categories;
  const series = input.series;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:chart>${titleXml(input.title)}<c:plotArea><c:layout/>${plotXml(input.chartType, series, categories)}${axesXml(input.chartType)}</c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
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
