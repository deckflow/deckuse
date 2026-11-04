import { expect, it } from 'vitest';
import { fontRiskReport } from '../../src/render-fonts.js';
it('reports converter resolution and CJK inheritance without claiming OS or glyph verification', () => {
  const result = fontRiskReport(
    {
      source: 'input OOXML',
      scope: 'slide 1',
      themeFonts: ['ThemeFont'],
      usages: [
        {
          target: 'slide:1/shape:Title',
          text: '中文 English 2026，。',
          fonts: ['MissingFont'],
          cjk: true,
          inheritance: 'explicit',
        },
        {
          target: 'slide:1/shape:Body',
          text: '继承中文',
          fonts: [],
          cjk: true,
          inheritance: 'theme',
        },
      ],
    },
    "warning: [font] unresolved 'MissingFont' 400/normal",
    1,
    '中文 English 2026，。',
  );
  expect(result.diagnostics.map((d) => d.code)).toEqual([
    'FONT_UNRESOLVED',
    'CJK_GLYPH_COVERAGE_UNVERIFIED',
    'CJK_FONT_INHERITANCE_UNVERIFIED',
    'RENDER_TEXT_CONTENT_UNVERIFIED',
  ]);
  expect(result.report.glyphCoverage).toBe('unknown');
  expect(result.report.substitution).toBe('unknown');
  expect(result.report.textContent.missingTargets).toEqual(['slide:1/shape:Body']);
});
it('keeps DOM text presence separate from visual approval and unknown probes', () => {
  const inventory = {
    source: 'input OOXML',
    scope: 'slide 1',
    themeFonts: [],
    usages: [
      {
        target: 'slide:1/shape:Title',
        text: '中文 English',
        fonts: ['sans-serif'],
        cjk: true,
        inheritance: 'explicit',
      },
    ],
  };
  const report = fontRiskReport(inventory, '', 1, '中文\nEnglish').report;
  expect(report.textContent.status).toBe('text-found');
  expect(report.textContent.visibilityAndClipping).toBe('unverified');
  expect(report.fontAvailability).toBe('unknown');
  expect(fontRiskReport(inventory, '', 1).report.textContent.status).toBe('unknown');
});
