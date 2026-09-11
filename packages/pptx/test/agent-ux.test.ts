import { describe, expect, it } from 'vitest';
import { computeAlignUpdates, type ShapeBBox } from '../src/align.js';
import { classifyChartDocument } from '../src/chart-classify.js';
import { buildChartXml } from '../src/chart.js';
import { estimateTableHeightEmu } from '../src/elements.js';
import { parseXml } from '@deckflow/deckuse-opc';

const box = (x: number, y: number, width: number, height: number): ShapeBBox =>
  ({ x, y, width, height, node: {} as ShapeBBox['node'] });

describe('align helpers', () => {
  it('distributes horizontally with gap', () => {
    const updates = computeAlignUpdates(
      [box(0, 0, 100, 50), box(200, 0, 100, 50), box(400, 0, 100, 50)],
      'distribute-h',
      '10',
      {},
    );
    expect(updates[0]).toEqual({ node: expect.anything() });
    expect(updates[1]?.x).toBe(110);
    expect(updates[2]?.x).toBe(220);
  });
});

describe('table height heuristic', () => {
  it('scales with row count', () => {
    expect(estimateTableHeightEmu(13)).toBeGreaterThan(estimateTableHeightEmu(2));
  });
});

describe('combo charts', () => {
  it('builds bar+line combo classified as basic', () => {
    const xml = buildChartXml({
      chartType: 'combo',
      categories: ['Q1', 'Q2'],
      series: [
        { name: 'Rev', values: [10, 20], chart: 'column' },
        { name: 'Margin', values: [0.1, 0.2], chart: 'line', axis: 'secondary' },
      ],
      showDataLabels: true,
      valueFormatCode: '0%',
    });
    expect(xml).toContain('barChart');
    expect(xml).toContain('lineChart');
    expect(xml).toContain('showVal val="1"');
    const doc = parseXml(xml);
    expect(classifyChartDocument(doc)).toBe('basic');
  });
});
