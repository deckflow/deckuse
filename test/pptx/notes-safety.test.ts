import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { notesBodyShape, NS } from '../../src/pptx/xml.js';
import { ensureNotes } from '../../src/pptx/slides.js';
import { OpcArchive } from '../../src/opc/index.js';
const parse = (body: string) =>
  new DOMParser().parseFromString(
    `<p:notes xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:notes>`,
    'application/xml',
  );
const shape = (type?: string) =>
  `<p:sp><p:nvSpPr><p:nvPr>${type ? `<p:ph type="${type}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>note</a:t></a:r></a:p></p:txBody></p:sp>`;
describe('speaker notes selection', () => {
  it('refuses ambiguous explicit bodies and ambiguous fallback shapes', () => {
    expect(notesBodyShape(parse(shape('body') + shape('body')))).toBeUndefined();
    expect(notesBodyShape(parse(shape() + shape()))).toBeUndefined();
  });
  it('prefers an explicit body and excludes decorative placeholders', () => {
    expect(notesBodyShape(parse(shape('hdr') + shape('body') + shape()))?.textContent).toBe('note');
    expect(notesBodyShape(parse(shape('hdr') + shape('sldNum')))).toBeUndefined();
  });
  it('reuses the presentation notes master and does not allocate another notes part on repeated writes', () => {
    const archive = new OpcArchive();
    archive.setPart(
      '/ppt/notesMasters/notesMaster1.xml',
      new TextEncoder().encode('<p:notesMaster xmlns:p="' + NS.p + '"/>'),
      'application/xml',
    );
    archive.setRelationships('/ppt/presentation.xml', [
      {
        id: 'rId1',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster',
        target: 'notesMasters/notesMaster1.xml',
        external: false,
        resolvedTarget: '/ppt/notesMasters/notesMaster1.xml',
      },
    ]);
    const part = ensureNotes(archive, '/ppt/slides/slide1.xml');
    expect(archive.getRelationships(part)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resolvedTarget: '/ppt/notesMasters/notesMaster1.xml' }),
      ]),
    );
    expect(ensureNotes(archive, '/ppt/slides/slide1.xml')).toBe(part);
  });
});
