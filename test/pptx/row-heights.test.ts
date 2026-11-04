import { expect, it } from 'vitest';
import { parseXml, serializeXml } from '../../src/opc/index.js';
import { applyTableLayout } from '../../src/pptx/table.js';
import { commandSchema } from '../../src/core/schema.js';
const fixture = () =>
  parseXml(
    `<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="2000000"/></p:xfrm><a:tbl><a:tblGrid><a:gridCol w="9144000"/></a:tblGrid>${[1, 2].map(() => '<a:tr h="1000000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Text</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>').join('')}</a:tbl></p:graphicFrame>`,
  );
it('sets each physical row and frame height exactly', () => {
  const doc = fixture();
  const result = applyTableLayout(doc.documentElement!, { rowHeights: [400000, 800000] });
  expect(result.ok).toBe(true);
  expect(
    [...Array.from(doc.getElementsByTagName('a:tr'))].map((row) => row.getAttribute('h')),
  ).toEqual(['400000', '800000']);
  expect(doc.getElementsByTagName('a:ext')[0]!.getAttribute('cy')).toBe('1200000');
});
it.each([[1], [0, 2], [-1, 2], [NaN, 2]])(
  'rejects invalid heights without changing XML: %j',
  (...heights) => {
    const doc = fixture(),
      before = serializeXml(doc);
    expect(applyTableLayout(doc.documentElement!, { rowHeights: heights }).ok).toBe(false);
    expect(serializeXml(doc)).toEqual(before);
  },
);
it('rejects competing layout policies in the public contract', () => {
  expect(
    commandSchema.safeParse({
      version: '2.0',
      type: 'setTableLayout',
      workspaceId: '/tmp/test',
      target: 'slide:1/shape:2',
      rowHeights: ['1in'],
      height: '2in',
    }).success,
  ).toBe(false);
});
