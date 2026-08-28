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
});
