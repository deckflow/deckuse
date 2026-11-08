import { it, expect } from 'vitest';
import { OpcArchive } from '../../src/opc/index.js';
import { assertIndependentFormulas } from '../../src/pptx/formula-dependencies.js';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
function fixture(formula: string) {
  const a = new OpcArchive(),
    e = new TextEncoder();
  a.setPart(
    '/xl/workbook.xml',
    e.encode(
      `<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
  );
  a.setRelationships('/xl/workbook.xml', [
    {
      id: 'rId1',
      type: R + '/worksheet',
      target: 'worksheets/sheet1.xml',
      resolvedTarget: '/xl/worksheets/sheet1.xml',
      external: false,
    },
  ]);
  a.setPart(
    '/xl/worksheets/sheet1.xml',
    e.encode(
      `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="C1"><f>${formula}</f><v>9</v></c></row></sheetData></worksheet>`,
    ),
  );
  return a;
}
it('allows constants unrelated to fully parsed formulas without changing cached results', () => {
  const a = fixture('SUM(A1:A2)+2'),
    before = a.getPart('/xl/worksheets/sheet1.xml')!.data.slice();
  expect(() => assertIndependentFormulas(a, [{ sheet: 'Data', address: 'B2' }])).not.toThrow();
  expect(a.getPart('/xl/worksheets/sheet1.xml')!.data).toEqual(before);
});
it.each(['SUM(A1:A2)', "'Data'!$A$1*2", 'A1'])('blocks dependencies: %s', (f) => {
  expect(() => assertIndependentFormulas(fixture(f), [{ sheet: 'Data', address: 'A1' }])).toThrow(
    /DEPENDENCY/,
  );
});
it.each(['INDIRECT("A1")', 'OFFSET(A1,1,0)', 'SomeName+1', 'Table1[Column]'])(
  'rejects unresolved syntax: %s',
  (f) => {
    expect(() => assertIndependentFormulas(fixture(f), [{ sheet: 'Data', address: 'B2' }])).toThrow(
      /UNRESOLVED/,
    );
  },
);
