import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  OpcArchive,
  normalizePartName,
  parseXml,
  prettyPrintXml,
  resolveRelationshipTarget,
  serializeXml,
} from '../src/index.js';
const enc = new TextEncoder();
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const contentTypes = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`;
describe('OPC archive', () => {
  it('normalizes and blocks traversal/XML entities', () => {
    expect(normalizePartName('ppt\\slides//slide1.xml')).toBe('/ppt/slides/slide1.xml');
    expect(() => normalizePartName('../secret')).toThrow();
    expect(() =>
      parseXml('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'),
    ).toThrow();
  });
  it('round trips content types, relationships and unchanged data', async () => {
    const archive = new OpcArchive();
    archive.setPart('/[Content_Types].xml', enc.encode(contentTypes), 'application/xml');
    const unknown = enc.encode('opaque bytes');
    archive.setPart('/custom/data.bin', unknown);
    archive.setRelationships('/ppt/slides/slide1.xml', [
      { id: 'rId1', type: 'image', target: '../media/image1.png', external: false },
    ]);
    const reopened = await OpcArchive.open(await archive.toUint8Array());
    expect(resolveRelationshipTarget('/ppt/slides/slide1.xml', '../media/image1.png')).toBe(
      '/ppt/media/image1.png',
    );
    expect(reopened.getRelationships('/ppt/slides/slide1.xml')[0]?.resolvedTarget).toBe(
      '/ppt/media/image1.png',
    );
    expect(digest(reopened.getPart('/custom/data.bin')!.data)).toBe(digest(unknown));
    expect(reopened.originalDigest('/custom/data.bin')).toBe(digest(unknown));
    expect(reopened.isUnmodified('/custom/data.bin')).toBe(true);
    reopened.setPart('/custom/data.bin', enc.encode('changed'));
    expect(reopened.isUnmodified('/custom/data.bin')).toBe(false);
  });
  it('enforces entry count', async () => {
    const archive = new OpcArchive();
    archive.setPart('/[Content_Types].xml', enc.encode(contentTypes), 'application/xml');
    archive.setPart('/a.xml', enc.encode('<a/>'), 'application/xml');
    await expect(OpcArchive.open(await archive.toUint8Array(), { maxEntries: 1 })).rejects.toThrow(
      'entry limit',
    );
  });
  it('pretty prints XML for readable git diffs', () => {
    const formatted = prettyPrintXml(contentTypes);
    expect(formatted).toContain('\n');
    expect(formatted).toMatch(/<Types[\s\S]*>\n/);
    const roundTrip = parseXml(formatted);
    expect(roundTrip.documentElement.tagName).toBe('Types');
    const serialized = new TextDecoder().decode(serializeXml(roundTrip));
    expect(serialized.split('\n').length).toBeGreaterThan(1);
  });

  it('preserves text-node character data while indenting element-only structure', () => {
    const input =
      '<?xml version="1.0"?><p:r><a:rPr dirty="0"/><a:t>领先的全球企业级</a:t></p:r>';
    const formatted = prettyPrintXml(input);
    expect(formatted).toBe(
      [
        '<?xml version="1.0"?>',
        '<p:r>',
        '  <a:rPr dirty="0"/>',
        '  <a:t>领先的全球企业级</a:t>',
        '</p:r>',
        '',
      ].join('\n'),
    );
    expect(formatted).toContain('<a:t>领先的全球企业级</a:t>');
    expect(formatted).not.toMatch(/<a:t>[^<]*\n/);
  });

  it('preserves whitespace-only and mixed text content exactly', () => {
    expect(prettyPrintXml('<a:t> </a:t>')).toBe('<a:t> </a:t>\n');
    expect(prettyPrintXml('<a:t></a:t>')).toBe('<a:t></a:t>\n');
    expect(prettyPrintXml('<a:p>text<a:br/>more</a:p>')).toBe('<a:p>text<a:br/>more</a:p>\n');
    expect(prettyPrintXml('<a:t xml:space="preserve">  hi  </a:t>')).toBe(
      '<a:t xml:space="preserve">  hi  </a:t>\n',
    );
  });

  it('does not change parsed text content of DrawingML runs', () => {
    const input = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:rPr dirty="0" err="1"/><a:t>领先的全球企业级</a:t></a:r><a:br/><a:r><a:t>数据分析</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;
    const before = parseXml(input);
    const after = parseXml(prettyPrintXml(input));
    const texts = (doc: Document) =>
      Array.from(doc.getElementsByTagName('a:t')).map((node) => node.textContent);
    expect(texts(after)).toEqual(texts(before));
  });
});
