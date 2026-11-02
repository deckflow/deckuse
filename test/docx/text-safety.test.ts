import { describe, expect, it } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { replaceInParagraph } from '../../src/docx/text-spans.js';
import { protectionReason } from '../../src/docx/xml.js';
const parse = (body: string) =>
  new DOMParser().parseFromString(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    'application/xml',
  );
const paragraph = (body: string) => parse(`<w:p>${body}</w:p>`).getElementsByTagName('w:p')[0]!;
const run = (s: string) => `<w:r><w:t>${s}</w:t></w:r>`;
describe('Word replacement safety', () => {
  it('matches only original text, including identity replacements', () => {
    const p = paragraph(run('A A'));
    expect(replaceInParagraph(p, 'A', 'AA', false, 2)).toMatchObject({ matched: 2 });
    expect(p.textContent).toBe('AA AA');
    expect(replaceInParagraph(p, 'AA', 'AA', false)).toMatchObject({ matched: 2, changes: [] });
  });
  it('preserves mixed-format unchanged prefixes', () => {
    const p = paragraph(
      '<w:r><w:rPr><w:b/></w:rPr><w:t>Keywords:</w:t></w:r>' + run(' Aquaculture; '),
    );
    expect(
      replaceInParagraph(p, 'Keywords: Aquaculture', 'Keywords: Aquaculture Test', false),
    ).toMatchObject({ matched: 1 });
    const xml = new XMLSerializer().serializeToString(p);
    expect(xml).toContain('<w:t>Keywords:</w:t>');
    expect(xml).toContain(' Aquaculture Test; ');
  });
  it('refuses ambiguous formatting without mutating', () => {
    const p = paragraph('<w:r><w:rPr><w:b/></w:rPr><w:t>AB</w:t></w:r>' + run('CD'));
    expect(replaceInParagraph(p, 'BC', 'XYZ', false)).toHaveProperty('error');
    expect(p.textContent).toBe('ABCD');
  });
  it('rejects invalid and empty regex matches', () => {
    const p = paragraph(run('ABC'));
    expect(replaceInParagraph(p, '[', 'X', true)).toMatchObject({ invalid: true });
    expect(replaceInParagraph(p, '^', 'X', true)).toMatchObject({ invalid: true });
  });
  it('does not match across tabs or hyperlink boundaries', () => {
    const p = paragraph('<w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r>');
    expect(replaceInParagraph(p, 'AB', 'C', false)).toMatchObject({ matched: 0 });
  });
  it('protects field results and cross-paragraph comment ranges for direct run writes', () => {
    const doc = parse(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p><w:p>' +
        run('123') +
        '</w:p><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    );
    expect(protectionReason(doc.getElementsByTagName('w:r')[1]!)).toBeDefined();
    const comments = parse(
      '<w:p><w:commentRangeStart w:id="1"/></w:p><w:p>' +
        run('123') +
        '</w:p><w:p><w:commentRangeEnd w:id="1"/></w:p>',
    );
    expect(protectionReason(comments.getElementsByTagName('w:r')[0]!)).toBeDefined();
  });
});

describe('namespace and malformed protection ranges', () => {
  it('uses namespace-aware field attributes and rejects indeterminate ranges', () => {
    const doc = new DOMParser().parseFromString(
      '<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:body><x:p><x:r><x:fldChar x:fldCharType="begin"/></x:r></x:p><x:p><x:r><x:t>123</x:t></x:r></x:p><x:p><x:r><x:fldChar x:fldCharType="end"/></x:r></x:p></x:body></x:document>',
      'application/xml',
    );
    expect(protectionReason(doc.getElementsByTagName('x:r')[1]!)).toBeDefined();
    const broken = paragraph(run('Normal') + '<w:r><w:fldChar w:fldCharType="end"/></w:r>');
    expect(protectionReason(broken)).toBeDefined();
  });
});
