import { DOMParser } from '@xmldom/xmldom';
import { describe, it, expect } from 'vitest';
import { buildBlankArchive } from '../../src/docx/blank.js';
import { NS } from '../../src/docx/xml.js';
import { mutateWordComments, wordComments } from '../../src/docx/comments.js';
import { mutateRevisions, decideRevisions, reviewView } from '../../src/docx/revision-engine.js';
import { scanRevisions } from '../../src/docx/revisions.js';
import type { ReviewWrite } from '../../src/review/schema.js';
const author = { id: 'alice', name: 'Alice' };
const now = new Date('2026-11-04T00:00:00Z');
const base = {
  version: '2.0' as const,
  workspaceId: 'test',
  transactionId: '1',
  expectRevision: '1',
};
const fixture = () => {
  const a = buildBlankArchive();
  a.setPart(
    '/word/document.xml',
    new TextEncoder().encode(
      `<w:document xmlns:w="${NS.w}"><w:body><w:p><w:r><w:t>Hello world</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
    ),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  );
  return a;
};
const change = (extra: Record<string, unknown>) => ({ ...base, ...extra }) as ReviewWrite;
const text = (a: ReturnType<typeof fixture>, view: 'original' | 'final') =>
  JSON.stringify((reviewView(a, view)['stories'] as { text: string }[]).map((n) => n.text));
describe('Word review workflow', () => {
  it('creates, replies, updates, resolves, reopens and removes a thread', () => {
    const a = fixture();
    const root = mutateWordComments(
      a,
      change({
        type: 'addComment',
        author,
        text: 'First\nSecond',
        anchor: {
          target: 'body/p:1',
          start: { target: 'body/p:1', offset: 1 },
          end: { target: 'body/p:1', offset: 5 },
        },
      }),
      now,
    );
    const id = String(root['id']);
    expect(wordComments(a)[0]?.text).toBe('First\nSecond');
    expect(a.getPart('/word/commentsExtended.xml')?.mediaType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml',
    );
    const reply = mutateWordComments(
      a,
      change({ type: 'replyComment', author, text: 'Reply', id }),
      now,
    );
    expect(wordComments(a)[1]?.parentId).toBe(id);
    expect(a.readXml('/word/document.xml').getElementsByTagName('w:commentReference')).toHaveLength(
      2,
    );
    mutateWordComments(a, change({ type: 'updateComment', id, text: 'Updated' }), now);
    expect(wordComments(a)[1]?.parentId).toBe(id);
    expect(a.readXml('/word/document.xml').getElementsByTagName('w:commentReference')).toHaveLength(
      2,
    );
    mutateWordComments(a, change({ type: 'resolveComment', id }), now);
    expect(wordComments(a)[0]?.resolved).toBe(true);
    expect(() =>
      mutateWordComments(a, change({ type: 'replyComment', author, text: 'blocked', id }), now),
    ).toThrow('Reopen');
    mutateWordComments(a, change({ type: 'reopenComment', id }), now);
    mutateWordComments(a, change({ type: 'deleteComment', id: String(reply['id']) }), now);
    expect(() => mutateWordComments(a, change({ type: 'deleteComment', id }), now)).toThrow(
      'thread',
    );
    mutateWordComments(a, change({ type: 'deleteComment', id, thread: true }), now);
    expect(wordComments(a)).toHaveLength(0);
    expect(
      a.readXml('/word/document.xml').getElementsByTagName('w:commentRangeStart'),
    ).toHaveLength(0);
  });
  it('creates native text revisions with original/final views and rejects to restore text', () => {
    const a = fixture();
    mutateRevisions(
      a,
      change({
        type: 'proposeChanges',
        author,
        operations: [
          {
            op: 'replaceText',
            start: { target: 'body/p:1', offset: 6 },
            end: { target: 'body/p:1', offset: 11 },
            text: 'everyone',
          },
        ],
      }),
      now,
    );
    expect(text(a, 'original')).toContain('Hello world');
    expect(text(a, 'final')).toContain('Hello everyone');
    decideRevisions(a, undefined, true, false);
    expect(scanRevisions(a).items).toHaveLength(0);
    expect(text(a, 'final')).toContain('Hello world');
  });
  it('accepts text replacement and refuses incomplete dependency selection', () => {
    const a = fixture();
    mutateRevisions(
      a,
      change({
        type: 'proposeChanges',
        author,
        operations: [
          {
            op: 'replaceText',
            start: { target: 'body/p:1', offset: 0 },
            end: { target: 'body/p:1', offset: 5 },
            text: 'Hi',
          },
        ],
      }),
      now,
    );
    expect(() => decideRevisions(a, [scanRevisions(a).items[0]!.id], false, true)).toThrow(
      'dependent',
    );
    decideRevisions(a, undefined, true, true);
    expect(text(a, 'final')).toContain('Hi world');
  });
  it.each(['insertParagraph', 'deleteParagraph', 'splitParagraph', 'mergeParagraph'] as const)(
    'round trips %s through rejection',
    (op) => {
      const a = fixture();
      const before = text(a, 'final');
      const operation =
        op === 'insertParagraph'
          ? { op, target: 'body/p:1', text: 'New' }
          : op === 'splitParagraph'
            ? { op, target: 'body/p:1', offset: 5 }
            : { op, target: 'body/p:1' };
      mutateRevisions(a, change({ type: 'proposeChanges', author, operations: [operation] }), now);
      decideRevisions(a, undefined, true, false);
      expect(text(a, 'final')).toBe(before);
    },
  );
});

describe('native structural revisions', () => {
  const withTable = () => {
    const a = fixture();
    const doc = a.readXml('/word/document.xml');
    const body = doc.getElementsByTagName('w:body')[0]!;
    const holder = new TextEncoder().encode(
      `<w:tbl xmlns:w="${NS.w}"><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>${[0, 1, 2].map((i) => `<w:tr>${[0, 1].map((j) => `<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${i},${j}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`,
    );
    const parsed = new DOMParser().parseFromString(
      new TextDecoder().decode(holder),
      'application/xml',
    );
    body.insertBefore(doc.importNode(parsed.documentElement!, true), body.lastChild);
    a.writeXml('/word/document.xml', doc);
    return a;
  };
  it('refuses structural table changes that could invalidate bookmark ranges', () => {
    const a = withTable();
    const doc = a.readXml('/word/document.xml');
    const p = doc.getElementsByTagName('w:tc')[0]!.getElementsByTagName('w:p')[0]!;
    const start = doc.createElementNS(NS.w, 'w:bookmarkStart');
    start.setAttributeNS(NS.w, 'w:id', '7');
    start.setAttributeNS(NS.w, 'w:name', 'TableRange');
    p.insertBefore(start, p.firstChild);
    const end = doc.createElementNS(NS.w, 'w:bookmarkEnd');
    end.setAttributeNS(NS.w, 'w:id', '7');
    p.appendChild(end);
    a.writeXml('/word/document.xml', doc);
    const before = a.getPart('/word/document.xml')!.data.slice();
    expect(() =>
      mutateRevisions(
        a,
        change({
          type: 'proposeChanges',
          author,
          operations: [{ op: 'deleteRow', target: 'body/table:1', index: 0 }],
        }),
        now,
      ),
    ).toThrow('bookmark');
    expect(a.getPart('/word/document.xml')!.data).toEqual(before);
  });
  it.each(['insertRow', 'deleteRow', 'insertColumn', 'deleteColumn'] as const)(
    'accepts and rejects %s',
    (op) => {
      for (const accept of [false, true]) {
        const a = withTable();
        const before = a.readXml('/word/document.xml').getElementsByTagName('w:t').length;
        mutateRevisions(
          a,
          change({
            type: 'proposeChanges',
            author,
            operations: [{ op, target: 'body/table:1', index: 1 }],
          }),
          now,
        );
        decideRevisions(a, undefined, true, accept);
        expect(scanRevisions(a).items).toHaveLength(0);
        const doc = a.readXml('/word/document.xml');
        if (!accept) expect(doc.getElementsByTagName('w:t').length).toBe(before);
        expect(doc.getElementsByTagName('w:tr').length).toBe(
          op === 'insertRow' && accept ? 4 : op === 'deleteRow' && accept ? 2 : 3,
        );
        expect(doc.getElementsByTagName('w:tc').length).toBe(
          accept
            ? op === 'insertRow'
              ? 8
              : op === 'deleteRow'
                ? 4
                : op === 'insertColumn'
                  ? 9
                  : 3
            : 6,
        );
      }
    },
  );
  it('round trips vertical merge and split', () => {
    const a = withTable();
    mutateRevisions(
      a,
      change({
        type: 'proposeChanges',
        author,
        operations: [{ op: 'mergeCells', target: 'body/table:1', row: 0, column: 0, count: 2 }],
      }),
      now,
    );
    decideRevisions(a, undefined, true, false);
    expect(a.readXml('/word/document.xml').getElementsByTagName('w:vMerge')).toHaveLength(0);
    mutateRevisions(
      a,
      change({
        type: 'proposeChanges',
        author,
        operations: [{ op: 'mergeCells', target: 'body/table:1', row: 0, column: 0, count: 2 }],
      }),
      now,
    );
    decideRevisions(a, undefined, true, true);
    expect(a.readXml('/word/document.xml').getElementsByTagName('w:vMerge')).toHaveLength(2);
    mutateRevisions(
      a,
      change({
        type: 'proposeChanges',
        author,
        operations: [{ op: 'splitCell', target: 'body/table:1', row: 0, column: 0, count: 2 }],
      }),
      now,
    );
    decideRevisions(a, undefined, true, false);
    expect(a.readXml('/word/document.xml').getElementsByTagName('w:vMerge')).toHaveLength(2);
  });
  it('rejects a move back to its source ordering', () => {
    const a = fixture();
    mutateRevisions(
      a,
      change({
        type: 'proposeChanges',
        author,
        operations: [
          { op: 'moveParagraphs', target: 'body/p:1', endTarget: 'body/p:1', after: 'body/p:2' },
        ],
      }),
      now,
    );
    decideRevisions(a, undefined, true, false);
    expect(text(a, 'final')).toContain('Hello world\\nNext');
  });
  it('restores native formatting on rejection', () => {
    const a = fixture();
    mutateRevisions(
      a,
      change({
        type: 'proposeChanges',
        author,
        operations: [
          {
            op: 'setProperties',
            target: 'body/p:1',
            properties: { bold: true, 'paragraph.align': 'center' },
          },
        ],
      }),
      now,
    );
    expect(scanRevisions(a).items.length).toBeGreaterThan(0);
    decideRevisions(a, undefined, true, false);
    expect(a.readXml('/word/document.xml').getElementsByTagName('w:b')).toHaveLength(0);
  });
});

describe('cross-paragraph revision views', () => {
  it.each([false, true])(
    'projects and decides a cross-paragraph replacement (accept=%s)',
    (accept) => {
      const a = fixture();
      const before = text(a, 'original');
      mutateRevisions(
        a,
        change({
          type: 'proposeChanges',
          author,
          operations: [
            {
              op: 'replaceText',
              start: { target: 'body/p:1', offset: 6 },
              end: { target: 'body/p:2', offset: 2 },
              text: 'ALL',
            },
          ],
        }),
        now,
      );
      expect(text(a, 'original')).toBe(before);
      expect(text(a, 'final')).toContain('Hello ALLxt');
      decideRevisions(a, undefined, true, accept);
      expect(scanRevisions(a).items).toHaveLength(0);
      expect(text(a, 'final')).toBe(accept ? '["Hello ALLxt"]' : before);
    },
  );
});

describe('review range and preservation edge cases', () => {
  it('refuses UTF-16 surrogate splits without writing archive changes', () => {
    const a = fixture();
    const doc = a.readXml('/word/document.xml');
    doc.getElementsByTagName('w:t')[0]!.textContent = 'A😀B';
    a.writeXml('/word/document.xml', doc);
    const before = a.getPart('/word/document.xml')!.data.slice();
    expect(() =>
      mutateRevisions(
        a,
        change({
          type: 'proposeChanges',
          author,
          operations: [
            {
              op: 'replaceText',
              start: { target: 'body/p:1', offset: 2 },
              end: { target: 'body/p:1', offset: 3 },
              text: 'X',
            },
          ],
        }),
        now,
      ),
    ).toThrow('UTF-16');
    expect(a.getPart('/word/document.xml')!.data).toEqual(before);
  });
  it('does not reuse native IDs across successive review proposals', () => {
    const a = fixture();
    const op = {
      op: 'replaceText',
      start: { target: 'body/p:1', offset: 0 },
      end: { target: 'body/p:1', offset: 5 },
      text: 'Hi',
    };
    mutateRevisions(a, change({ type: 'proposeChanges', author, operations: [op] }), now);
    const ids = scanRevisions(a).items.map((n) => n.nativeId);
    decideRevisions(a, undefined, true, false);
    mutateRevisions(a, change({ type: 'proposeChanges', author, operations: [op] }), now);
    expect(scanRevisions(a).items.every((n) => !ids.includes(n.nativeId))).toBe(true);
  });
  it('keeps all original package bytes unchanged when projecting views', () => {
    const a = fixture();
    mutateRevisions(
      a,
      change({
        type: 'proposeChanges',
        author,
        operations: [{ op: 'insertParagraph', target: 'body/p:1', text: 'New' }],
      }),
      now,
    );
    const before = new Map([...a.parts].map(([part, data]) => [part, data.data.slice()]));
    for (const view of ['original', 'final', 'markup'] as const) reviewView(a, view);
    for (const [part, bytes] of before) expect(a.getPart(part)!.data).toEqual(bytes);
  });
});

describe('unsupported review structures', () => {
  it('detects unknown revision markup and refuses decisions', () => {
    const a = fixture();
    const doc = a.readXml('/word/document.xml');
    const p = doc.getElementsByTagName('w:p')[0]!;
    const unknown = doc.createElementNS(NS.w, 'w:futurePrChange');
    unknown.setAttributeNS(NS.w, 'w:id', '77');
    p.appendChild(unknown);
    a.writeXml('/word/document.xml', doc);
    expect(scanRevisions(a).items[0]?.opaque).toBe(true);
    expect(reviewView(a, 'final')['complete']).toBe(false);
    expect(() => decideRevisions(a, undefined, true, true)).toThrow('Unsupported');
  });
  it('keeps revisions inside text boxes read-only', () => {
    const a = fixture();
    const doc = a.readXml('/word/document.xml');
    const body = doc.getElementsByTagName('w:body')[0]!;
    const box = doc.createElementNS(NS.w, 'w:txbxContent');
    const p = doc.createElementNS(NS.w, 'w:p'),
      ins = doc.createElementNS(NS.w, 'w:ins');
    ins.setAttributeNS(NS.w, 'w:id', '44');
    const r = doc.createElementNS(NS.w, 'w:r'),
      t = doc.createElementNS(NS.w, 'w:t');
    t.textContent = 'box';
    r.appendChild(t);
    ins.appendChild(r);
    p.appendChild(ins);
    box.appendChild(p);
    body.insertBefore(box, body.lastChild);
    a.writeXml('/word/document.xml', doc);
    expect(scanRevisions(a).items[0]?.capabilities.accept).toBe(false);
    expect(() => decideRevisions(a, undefined, true, true)).toThrow('Read-only');
  });
  it('requires explicit compatibility upgrade before replying to old Word documents', () => {
    const a = fixture();
    a.deletePart('/word/settings.xml');
    const root = mutateWordComments(
      a,
      change({ type: 'addComment', author, text: 'Legacy', anchor: { target: 'body/p:1' } }),
      now,
    );
    expect(wordComments(a)[0]?.capabilities.reply).toBe(false);
    expect(() =>
      mutateWordComments(
        a,
        change({ type: 'replyComment', id: root['id'], text: 'Reply', author }),
        now,
      ),
    ).toThrow('upgradeComments');
    mutateWordComments(a, change({ type: 'upgradeComments' }), now);
    mutateWordComments(
      a,
      change({ type: 'replyComment', id: root['id'], text: 'Reply', author }),
      now,
    );
    expect(wordComments(a)).toHaveLength(2);
  });
});

describe('paragraph property snapshots', () => {
  it('keeps paragraph-mark formatting and section properties outside pPrChange snapshots', () => {
    const a = fixture();
    const doc = a.readXml('/word/document.xml');
    const p = doc.getElementsByTagName('w:p')[0]!;
    const props = doc.createElementNS(NS.w, 'w:pPr'),
      rpr = doc.createElementNS(NS.w, 'w:rPr');
    rpr.appendChild(doc.createElementNS(NS.w, 'w:b'));
    props.appendChild(rpr);
    props.appendChild(doc.createElementNS(NS.w, 'w:sectPr'));
    p.insertBefore(props, p.firstChild);
    a.writeXml('/word/document.xml', doc);
    mutateRevisions(
      a,
      change({
        type: 'proposeChanges',
        author,
        operations: [
          { op: 'setProperties', target: 'body/p:1', properties: { 'paragraph.align': 'center' } },
        ],
      }),
      now,
    );
    const changed = a.readXml('/word/document.xml').getElementsByTagName('w:pPrChange')[0]!;
    expect(changed.getElementsByTagName('w:rPr')).toHaveLength(0);
    expect(changed.getElementsByTagName('w:sectPr')).toHaveLength(0);
    decideRevisions(a, undefined, true, false);
    const restored = a.readXml('/word/document.xml');
    expect(restored.getElementsByTagName('w:b')).toHaveLength(1);
    expect(restored.getElementsByTagName('w:sectPr')).toHaveLength(2);
  });
});

describe('revision operation group identity', () => {
  const proposal = () => ({
    type: 'proposeChanges',
    author,
    operations: [
      {
        op: 'replaceText',
        start: { target: 'body/p:1', offset: 0 },
        end: { target: 'body/p:1', offset: 5 },
        text: 'Hi',
      },
    ],
  });
  it('accepts a complete explicit group after serialization', () => {
    const a = fixture();
    mutateRevisions(a, change(proposal()), now);
    const ids = scanRevisions(a).items.map((n) => n.id);
    expect(() => decideRevisions(a, ids, false, true)).not.toThrow();
  });
  it('refuses stale partial group decisions after an external renumbering', () => {
    const a = fixture();
    mutateRevisions(a, change(proposal()), now);
    const doc = a.readXml('/word/document.xml');
    for (const n of [
      ...Array.from(doc.getElementsByTagName('w:ins')),
      ...Array.from(doc.getElementsByTagName('w:del')),
    ])
      n.setAttributeNS(NS.w, 'w:id', String(Number(n.getAttributeNS(NS.w, 'id')) + 100));
    a.writeXml('/word/document.xml', doc);
    const ids = scanRevisions(a).items.map((n) => n.id);
    expect(() => decideRevisions(a, ids, false, true)).toThrow('externally');
    expect(() => decideRevisions(a, undefined, true, true)).not.toThrow();
  });
});
