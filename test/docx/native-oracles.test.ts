import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseXml } from '../../src/opc/index.js';
import { buildBlankArchive } from '../../src/docx/blank.js';
import { decideRevisions } from '../../src/docx/revision-engine.js';
import { all, elements } from '../../src/review/xml.js';
import { NS } from '../../src/docx/xml.js';
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/review/word-16.78-decisions.json', import.meta.url), 'utf8'),
) as { cases: { name: string; sourceXml: string; acceptedXml: string; rejectedXml?: string }[] };
const semantics = (xml: string) => {
  const doc = parseXml(xml);
  const body = all(doc, NS.w, 'body')[0]!;
  const paragraph = (p: ReturnType<typeof all>[number]) => ({
    text: all(p, NS.w, 't')
      .map((n) => n.textContent ?? '')
      .join(''),
    align: all(p, NS.w, 'jc')[0]?.getAttributeNS(NS.w, 'val') ?? 'left',
    bold: all(p, NS.w, 'r').flatMap((r) =>
      all(r, NS.w, 't').flatMap((t) =>
        Array.from(t.textContent ?? '').map((ch) => ({
          ch,
          bold: all(r, NS.w, 'b').some(
            (b) => !['0', 'false', 'off'].includes(b.getAttributeNS(NS.w, 'val') ?? '1'),
          ),
        })),
      ),
    ),
  });
  const paragraphs = elements(body)
    .filter((n) => n.localName === 'p')
    .map(paragraph);
  while (paragraphs.at(-1)?.text === '') paragraphs.pop();
  return {
    paragraphs,
    tables: all(body, NS.w, 'tbl').map((table) => ({
      columns: all(table, NS.w, 'tblGrid')[0]
        ? elements(all(table, NS.w, 'tblGrid')[0]!).filter((n) => n.localName === 'gridCol').length
        : 0,
      rows: elements(table)
        .filter((n) => n.localName === 'tr')
        .map((row) =>
          elements(row)
            .filter((n) => n.localName === 'tc')
            .map((cell) => ({
              paragraphs: elements(cell)
                .filter((n) => n.localName === 'p')
                .map((p) => paragraph(p).text),
              merge:
                all(cell, NS.w, 'vMerge')[0]?.getAttributeNS(NS.w, 'val') ??
                (all(cell, NS.w, 'vMerge').length ? 'continue' : null),
            })),
        ),
    })),
  };
};
describe('Microsoft Word 16.78 decision oracles', () => {
  for (const c of fixture.cases) {
    it(`matches native acceptance: ${c.name}`, () => {
      const archive = buildBlankArchive();
      archive.setPart(
        '/word/document.xml',
        new TextEncoder().encode(c.sourceXml),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      );
      decideRevisions(archive, undefined, true, true);
      expect(
        semantics(new TextDecoder().decode(archive.getPart('/word/document.xml')!.data)),
      ).toEqual(semantics(c.acceptedXml));
    });
    if (c.rejectedXml)
      it(`matches native rejection: ${c.name}`, () => {
        const archive = buildBlankArchive();
        archive.setPart(
          '/word/document.xml',
          new TextEncoder().encode(c.sourceXml),
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        );
        decideRevisions(archive, undefined, true, false);
        expect(
          semantics(new TextDecoder().decode(archive.getPart('/word/document.xml')!.data)),
        ).toEqual(semantics(c.rejectedXml!));
      });
  }
});
