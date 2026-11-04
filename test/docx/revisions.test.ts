import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBlankArchive, docxAdapter } from '../../src/docx/index.js';
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { OpcArchive } from '../../src/opc/index.js';
import { scanRevisions } from '../../src/docx/revisions.js';
import { protectionReason, NS } from '../../src/docx/xml.js';
import { commandSchema } from '../../src/core/schema.js';

const parse = (body: string) =>
  new DOMParser().parseFromString(
    `<x:document xmlns:x="${NS.w}" xmlns:other="urn:other"><x:body>${body}</x:body></x:document>`,
    'application/xml',
  );
const run = '<x:r><x:t>text</x:t></x:r>';

describe('tracked revision safety', () => {
  it.each([
    'rPrChange',
    'pPrChange',
    'tblPrChange',
    'tblGridChange',
    'trPrChange',
    'tcPrChange',
    'cellIns',
    'cellDel',
    'cellMerge',
    'numberingChange',
  ])('protects %s without depending on the namespace prefix', (name) => {
    const doc = parse(`<x:p><x:pPr><x:${name} x:id="1"/></x:pPr>${run}</x:p>`);
    expect(protectionReason(doc.getElementsByTagName('x:r')[0]!)).toBeDefined();
  });
  it('protects a run under revised row properties', () => {
    const doc = parse(
      `<x:tbl><x:tr><x:trPr><x:del x:id="1"/></x:trPr><x:tc><x:p>${run}</x:p></x:tc></x:tr></x:tbl>`,
    );
    expect(protectionReason(doc.getElementsByTagName('x:r')[0]!)).toBeDefined();
  });
  it('protects document-spanning move ranges while allowing an unrelated paragraph', () => {
    const doc = parse(
      `<x:p><x:moveFromRangeStart x:id="0"/></x:p><x:p>${run}</x:p><x:p><x:moveFromRangeEnd x:id="0"/></x:p><x:p>${run}</x:p>`,
    );
    const runs = doc.getElementsByTagName('x:r');
    expect(protectionReason(runs[0]!)).toBeDefined();
    expect(protectionReason(runs[1]!)).toBeUndefined();
  });
  it('fails closed on an unpaired range', () => {
    const doc = parse(`<x:p><x:moveToRangeEnd x:id="1"/></x:p><x:p>${run}</x:p>`);
    expect(protectionReason(doc.getElementsByTagName('x:r')[0]!)).toBeDefined();
  });
  it('does not interpret foreign revision names as Word revisions', () => {
    const doc = parse(`<x:p><other:ins/>${run}</x:p>`);
    expect(protectionReason(doc.getElementsByTagName('x:r')[0]!)).toBeUndefined();
  });
});

describe('revision inventory', () => {
  it('scans all Word XML parts without changing bytes and keeps IDs stable on text edits', () => {
    const archive = new OpcArchive();
    const content = (text: string) =>
      new TextEncoder().encode(
        `<x:hdr xmlns:x="${NS.w}"><x:p><x:ins x:id="8" x:author="Alice"><x:r><x:t>${text}</x:t></x:r></x:ins></x:p></x:hdr>`,
      );
    archive.setPart('/word/header1.xml', content('before'), 'application/xml');
    const before = archive.getPart('/word/header1.xml')!.data.slice();
    const first = scanRevisions(archive);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      type: 'ins',
      author: 'Alice',
      text: 'before',
      capabilities: { accept: false },
    });
    expect(archive.getPart('/word/header1.xml')!.data).toEqual(before);
    archive.setPart('/word/header1.xml', content('after'), 'application/xml');
    expect(scanRevisions(archive).items[0]!.id).toBe(first.items[0]!.id);
  });
  it('reports malformed ranges without enabling review decisions', () => {
    const archive = new OpcArchive();
    archive.setPart(
      '/word/document.xml',
      new TextEncoder().encode(
        `<x:document xmlns:x="${NS.w}"><x:moveFromRangeEnd x:id="2"/></x:document>`,
      ),
      'application/xml',
    );
    expect(scanRevisions(archive).diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'REVISION_RANGE_UNPAIRED' })]),
    );
  });
  it('validates the additive query protocol', () => {
    expect(
      commandSchema.safeParse({ version: '2.0', type: 'listRevisions', workspaceId: '/tmp/work' })
        .success,
    ).toBe(true);
    expect(
      commandSchema.safeParse({ version: '2.0', type: 'getRevision', workspaceId: '/tmp/work' })
        .success,
    ).toBe(false);
  });
});

describe('revision inventory adapter integration', () => {
  it('queries revisions and rejects destructive writes without changing the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-review-'));
    try {
      const source = join(root, 'source.docx');
      const workspaceId = join(root, 'work');
      const archive = buildBlankArchive();
      archive.setPart(
        '/word/document.xml',
        new TextEncoder().encode(
          `<w:document xmlns:w="${NS.w}"><w:body><w:p><w:pPr><w:pPrChange w:id="1" w:author="Alice"><w:pPr/></w:pPrChange></w:pPr><w:r><w:t>before</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
        ),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      );
      await archive.writeFile(source);
      const base = { version: '2.0' as const, workspaceId };
      expect((await docxAdapter.init({ ...base, type: 'init', format: 'docx', source })).ok).toBe(
        true,
      );
      const listing = await docxAdapter.execute({ ...base, type: 'listRevisions' });
      expect(listing.ok).toBe(true);
      if (!listing.ok) return;
      const items = (listing.value as { items: { id: string }[] }).items;
      expect(items).toHaveLength(1);
      expect(
        (await docxAdapter.execute({ ...base, type: 'getRevision', id: items[0]!.id })).ok,
      ).toBe(true);
      const before = await readFile(join(workspaceId, 'source/word/document.xml'));
      const manifest = await readFile(join(workspaceId, '.deckuse/manifest.json'));
      const rejected = await docxAdapter.execute({
        ...base,
        type: 'setText',
        transactionId: '1',
        target: 'body/p:1',
        text: 'after',
      });
      expect(rejected.ok).toBe(false);
      expect(await readFile(join(workspaceId, 'source/word/document.xml'))).toEqual(before);
      expect(await readFile(join(workspaceId, '.deckuse/manifest.json'))).toEqual(manifest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
