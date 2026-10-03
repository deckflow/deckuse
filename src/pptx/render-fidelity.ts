import type { Diagnostic } from '../core/index.js';
import type { OpcArchive } from '../opc/index.js';
import { readSeriesColor } from './chart.js';
import { classifyChartDocument, classifyChartPart } from './chart-classify.js';
import { slidePartAtPage } from './slides.js';
import { REL, children, descendants, first } from './xml.js';

const isComboPlot = (chartPart: string, archive: OpcArchive): boolean => {
  try {
    const doc = archive.readXml(chartPart);
    const plotArea = first(doc, 'plotArea');
    if (!plotArea) return false;
    const families = new Set(
      children(plotArea)
        .map((child) => child.localName ?? '')
        .filter((name) => name.endsWith('Chart')),
    );
    return families.has('barChart') && families.has('lineChart');
  } catch {
    return false;
  }
};

/** Community deck2html limits for one slide: combo/advanced placeholder and custom series colors. */
export function chartRenderDiagnostics(archive: OpcArchive, page: number): Diagnostic[] {
  const slidePart = slidePartAtPage(archive, page);
  if (!slidePart) return [];
  const diagnostics: Diagnostic[] = [];
  let combo = false;
  let seriesColor = false;
  for (const rel of archive.getRelationships(slidePart)) {
    if (rel.type !== REL.chart || !rel.resolvedTarget) continue;
    const chartPart = rel.resolvedTarget;
    const variant = classifyChartPart(archive, chartPart);
    if (variant === 'advanced' || isComboPlot(chartPart, archive)) combo = true;
    try {
      const doc = archive.readXml(chartPart);
      if (classifyChartDocument(doc) === 'advanced') combo = true;
      for (const ser of descendants(doc, 'ser')) {
        if (readSeriesColor(ser)) seriesColor = true;
      }
    } catch {
      combo = true;
    }
  }
  if (combo) {
    diagnostics.push({
      severity: 'warning',
      code: 'COMBO_CHART_RENDER_LIMITED',
      message:
        'This page has a combo or advanced chart; community render may show an Advanced Chart placeholder. Verify chart XML or open in PowerPoint.',
      details: { page },
    });
  }
  if (seriesColor) {
    diagnostics.push({
      severity: 'warning',
      code: 'CHART_SERIES_COLOR_UNVERIFIED',
      message:
        'This page has explicit chart series colors; community render legend/series fills may not match. Verify ppt/charts/*.xml or open in PowerPoint.',
      details: { page },
    });
  }
  return diagnostics;
}
