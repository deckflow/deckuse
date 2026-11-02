import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { OpcArchive } from '../../src/opc/index.js';
import { buildChartXml, type ChartCreateInput } from '../../src/pptx/chart.js';
import { verifyChartData } from '../../src/pptx/chart-data.js';
import { auditVisuals } from '../../src/pptx/visual-audit.js';
import { NS, REL } from '../../src/pptx/xml.js';
import { parseXml } from '../../src/opc/index.js';
import { descendants } from '../../src/pptx/xml.js';
const encode = (s: string) => new TextEncoder().encode(s);
describe('visual audit and controlled chart baseline', () => {
  it('covers native chart colors, labels, axes, combination, title and Chinese cases', async () => {
    const cases = JSON.parse(
      await readFile(new URL('../fixtures/visual/cases.json', import.meta.url), 'utf8'),
    ) as (ChartCreateInput & { name: string })[];
    expect(cases).toHaveLength(8);
    for (const item of cases) {
      const xml = buildChartXml(item),
        doc = parseXml(xml);
      expect(descendants(doc, 'ser')).toHaveLength(item.series.length);
      expect(
        descendants(doc, 't')
          .map((n) => n.textContent)
          .join(''),
      ).toContain(item.title);
      for (const series of item.series) if (series.color) expect(xml).toContain(series.color);
      if (item.chartType === 'combo') expect(descendants(doc, 'valAx')).toHaveLength(2);
      if (item.showDataLabels)
        expect(descendants(doc, 'showVal').some((n) => n.getAttribute('val') === '1')).toBe(true);
    }
  });
  it('reports factual bounds separately from heuristic overflow/overlap and image semantics', async () => {
    const a = await OpcArchive.openFile(
      new URL('../../assets/default.pptx', import.meta.url).pathname.replace(
        '/test/assets/',
        '/assets/',
      ),
    );
    const slide = a
      .getRelationships('/ppt/presentation.xml')
      .find((r) => r.type === REL.slide)!.resolvedTarget!;
    const doc = a.readXml(slide),
      tree = descendants(doc, 'spTree')[0]!;
    for (const child of [...Array.from(tree.childNodes)]) tree.removeChild(child);
    const shape = (id: number, x: number, text: string) =>
      `<p:sp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvSpPr><p:cNvPr id="${id}" name="Text${id}"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="0"/><a:ext cx="1000000" cy="100000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2400"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
    for (const [id, x] of [
      [2, -100],
      [3, 300000],
    ])
      tree.appendChild(
        doc.importNode(
          parseXml(shape(id!, x!, 'Long content that will wrap many times')).documentElement,
          true,
        ),
      );
    tree.appendChild(
      doc.importNode(
        parseXml(
          `<p:pic xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:nvPicPr><p:cNvPr id="4" name="Picture"/></p:nvPicPr><p:blipFill><a:blip r:embed="missing"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr></p:pic>`,
        ).documentElement,
        true,
      ),
    );
    a.writeXml(slide, doc);
    const audit = auditVisuals(a);
    const codes = audit.diagnostics.map((d) => d.code);
    expect(codes).toContain('OBJECT_OUT_OF_BOUNDS');
    expect(codes).toContain('TEXT_OVERFLOW_SUSPECTED');
    expect(codes).toContain('CONTENT_OVERLAP_SUSPECTED');
    expect(codes).toContain('MISSING_IMAGE_RELATIONSHIP');
    expect(audit.reviewItems).toHaveLength(1);
    expect(audit.reviewItems[0]!.evidence['classification']).toBe('unreviewed');
    expect(audit.fontVerification).toBe('unknown');
  });
  it('re-verifies real PowerPoint-saved constant workbooks with preserved Office metadata', async () => {
    const archive = await OpcArchive.openFile(
      new URL('../fixtures/visual/native/workbook-roundtrip.pptx', import.meta.url).pathname,
    );
    const report = await verifyChartData(archive);
    expect(report.filter((c) => c.status === 'consistent')).toHaveLength(2);
    expect(report.some((c) => c.status === 'unverified' || c.status === 'inconsistent')).toBe(
      false,
    );
  });
});
