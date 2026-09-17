import type { OpcArchive } from '@deckflow/deckuse-opc';
import type { Document, Element } from '@xmldom/xmldom';
import { NS, children, descendants, first, root } from './xml.js';

export type ChartVariant = 'basic' | 'advanced';

/** Basic Legacy Chart families per edition scope §4.2. */
const BASIC_CHART_LOCAL_NAMES = new Set(['pieChart', 'lineChart', 'barChart']);

const CHART_EX_URI = 'http://schemas.microsoft.com/office/drawing/2014/chartex';

const isElement = (node: { nodeType: number }): node is Element => node.nodeType === 1;

/** Local names under c:plotArea that represent a chart family (…Chart). */
const plotAreaChartFamilies = (plotArea: Element): string[] =>
  children(plotArea)
    .filter(isElement)
    .map((child) => child.localName ?? '')
    .filter((name) => name.endsWith('Chart'));

/**
 * Classify a Legacy Chart / ChartEx document as basic or advanced.
 * Fail closed: anything not a single basic family (or community-allowed bar+line combo) is advanced.
 */
export const classifyChartDocument = (doc: Document): ChartVariant => {
  const docEl = root(doc);
  // ChartEx root is typically cx:chartSpace
  if (docEl.namespaceURI === CHART_EX_URI) return 'advanced';
  if (descendants(doc).some((n) => n.namespaceURI === CHART_EX_URI)) return 'advanced';

  const plotArea = first(doc, 'plotArea');
  if (!plotArea) return 'advanced';

  const families = plotAreaChartFamilies(plotArea);
  // Community-allowed limited combo: exactly barChart + lineChart.
  if (
    families.length === 2 &&
    families.includes('barChart') &&
    families.includes('lineChart')
  ) {
    return 'basic';
  }
  if (families.length !== 1) return 'advanced';
  const only = families[0]!;
  if (!BASIC_CHART_LOCAL_NAMES.has(only)) return 'advanced';

  // Ensure the family node is in the DrawingML chart NS (or unprefixed legacy default).
  const familyNode = children(plotArea).find((c) => c.localName === only);
  if (
    familyNode &&
    familyNode.namespaceURI != null &&
    familyNode.namespaceURI !== NS.c &&
    familyNode.namespaceURI !== ''
  ) {
    return 'advanced';
  }

  return 'basic';
};

export const classifyChartPart = (archive: OpcArchive, chartPart: string): ChartVariant => {
  const part = archive.getPart(chartPart);
  if (!part) return 'advanced';
  if (part.mediaType.includes('chartex')) return 'advanced';
  try {
    return classifyChartDocument(archive.readXml(chartPart));
  } catch {
    return 'advanced';
  }
};
