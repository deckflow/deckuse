import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OpcArchive,
  decodeXmlBytes,
  formatXmlBytes,
  normalizePartName,
  parseXml,
  prettyPrintXml,
  resolveRelationshipTarget,
  serializeXml,
} from '../../src/opc/index.js';
const enc = new TextEncoder();
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const contentTypes = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`;
const encodeUtf16Be = (text: string): Uint8Array => {
  const body = Buffer.from(text, 'utf16le');
  // swap to BE and prepend BOM FE FF
  const be = Buffer.alloc(2 + body.length);
  be[0] = 0xfe;
  be[1] = 0xff;
  for (let i = 0; i < body.length; i += 2) {
    be[2 + i] = body[i + 1]!;
    be[2 + i + 1] = body[i]!;
  }
  return new Uint8Array(be);
};
const encodeUtf16Le = (text: string): Uint8Array => {
  const body = Buffer.from(text, 'utf16le');
  const out = Buffer.alloc(2 + body.length);
  out[0] = 0xff;
  out[1] = 0xfe;
  body.copy(out, 2);
  return new Uint8Array(out);
};
describe('OPC archive', () => {
  it('normalizes and blocks traversal/XML entities', () => {
    expect(normalizePartName('ppt\\slides//slide1.xml')).toBe('/ppt/slides/slide1.xml');
    expect(() => normalizePartName('../secret')).toThrow();
    expect(() =>
      parseXml('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'),
    ).toThrow();
  });

  it('parses UTF-16 BE/LE XML parts with BOM', () => {
    const xml = '<?xml version="1.0" encoding="UTF-16"?><root attr="值"><child/></root>';
    const be = encodeUtf16Be(xml);
    const le = encodeUtf16Le(xml);
    expect(be[0]).toBe(0xfe);
    expect(le[0]).toBe(0xff);
    expect(parseXml(be).documentElement.tagName).toBe('root');
    expect(parseXml(le).documentElement.getAttribute('attr')).toBe('值');
    expect(
      decodeXmlBytes(be).startsWith('<?xml') || decodeXmlBytes(be).startsWith('\ufeff<?xml'),
    ).toBe(true);
  });

  it('rewrites UTF-16 parts to UTF-8 when formatting', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-16"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';
    const formatted = formatXmlBytes(encodeUtf16Be(xml));
    expect(formatted[0]).toBe(0x3c); // '<' — UTF-8, no BOM
    const text = new TextDecoder().decode(formatted);
    expect(text).toMatch(/encoding="UTF-8"/i);
    expect(text).not.toMatch(/encoding="UTF-16"/i);
    expect(parseXml(formatted).documentElement.tagName).toBe('Relationships');
  });

  it('opens packages whose relationship parts are UTF-16', async () => {
    const archive = new OpcArchive();
    archive.setPart('/[Content_Types].xml', enc.encode(contentTypes), 'application/xml');
    archive.setPart(
      '/_rels/.rels',
      encodeUtf16Be(
        '<?xml version="1.0" encoding="UTF-16"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
      ),
      'application/vnd.openxmlformats-package.relationships+xml',
    );
    archive.setPart(
      '/ppt/presentation.xml',
      encodeUtf16Be(
        '<?xml version="1.0" encoding="UTF-16"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
      ),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    );
    const reopened = await OpcArchive.open(await archive.toUint8Array());
    expect(reopened.getRelationships('/')[0]?.target).toBe('ppt/presentation.xml');
    expect(reopened.readXml('/ppt/presentation.xml').documentElement.localName).toBe(
      'presentation',
    );
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
  it('hasPartIgnoreCase detects MP4/mp4 path collisions', () => {
    const archive = new OpcArchive();
    archive.setPart('/[Content_Types].xml', enc.encode(contentTypes), 'application/xml');
    archive.setPart('/ppt/media/media1.MP4', enc.encode('video'), 'video/mp4');
    expect(archive.getPart('/ppt/media/media1.mp4')).toBeUndefined();
    expect(archive.hasPartIgnoreCase('/ppt/media/media1.mp4')).toBe(true);
    expect(archive.hasPartIgnoreCase('/ppt/media/media2.mp4')).toBe(false);
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
    const input = '<?xml version="1.0"?><p:r><a:rPr dirty="0"/><a:t>领先的全球企业级</a:t></p:r>';
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

  it('writeDirectory syncs Content_Types overrides for new parts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opc-ct-'));
    const archive = new OpcArchive();
    archive.setPart('/[Content_Types].xml', enc.encode(contentTypes), 'application/xml');
    archive.setPart(
      '/ppt/slides/slide1.xml',
      enc.encode('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'),
      'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
    );
    archive.setPart(
      '/ppt/charts/chart1.xml',
      enc.encode(
        '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
      ),
      'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
    );
    const dir = join(root, 'source');
    await archive.writeDirectory(dir);
    const ct = await readFile(join(dir, '[Content_Types].xml'), 'utf8');
    expect(ct).toContain(
      'PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"',
    );
    expect(ct).toContain(
      'PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"',
    );

    const reopened = await OpcArchive.openDirectory(dir);
    expect(reopened.getPart('/ppt/charts/chart1.xml')?.mediaType).toBe(
      'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
    );
    expect(reopened.getPart('/ppt/slides/slide1.xml')?.mediaType).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
    );
  });

  it('does not emit Content_Types Override for .rels when Default exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opc-rels-ct-'));
    const archive = new OpcArchive();
    archive.contentTypes.defaults.set(
      'rels',
      'application/vnd.openxmlformats-package.relationships+xml',
    );
    archive.contentTypes.defaults.set('xml', 'application/xml');
    archive.setPart(
      '/ppt/presentation.xml',
      enc.encode(
        '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
      ),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    );
    archive.setRelationships('/ppt/presentation.xml', [
      {
        id: 'rId1',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
        target: 'slides/slide1.xml',
        external: false,
      },
    ]);
    const dir = join(root, 'source');
    await archive.writeDirectory(dir);
    const ct = await readFile(join(dir, '[Content_Types].xml'), 'utf8');
    expect(ct).toContain('Extension="rels"');
    expect(ct).not.toContain('PartName="/ppt/_rels/presentation.xml.rels"');
  });

  it('does not pretty-print binary xlsx embeddings as XML', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opc-embed-'));
    const archive = new OpcArchive();
    archive.contentTypes.defaults.set('xml', 'application/xml');
    archive.contentTypes.defaults.set(
      'xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    // Minimal ZIP (local file + EOCD) — must survive writeDirectory byte-for-byte.
    const xlsx = Uint8Array.from([
      0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    archive.setPart(
      '/ppt/embeddings/book.xlsx',
      xlsx,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    // Also ensure +xml chart parts still format.
    archive.setPart(
      '/ppt/charts/chart1.xml',
      enc.encode(
        '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart/></c:chartSpace>',
      ),
      'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
    );
    const dir = join(root, 'source');
    await archive.writeDirectory(dir);
    const written = await readFile(join(dir, 'ppt/embeddings/book.xlsx'));
    expect(Buffer.from(written)).toEqual(Buffer.from(xlsx));
    const chart = await readFile(join(dir, 'ppt/charts/chart1.xml'), 'utf8');
    expect(chart).toContain('\n');
  });
});
