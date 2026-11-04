import { describe, expect, it } from 'vitest';
import { OpcArchive } from '../../src/opc/index.js';
import { NS, REL } from '../../src/pptx/xml.js';
import { buildIndex } from '../../src/pptx/indexer.js';
import {
  mutateSlideComments,
  slideComments,
  cloneSlideComments,
  guardCommentMutation,
} from '../../src/pptx/comments.js';
import type { ReviewWrite } from '../../src/review/schema.js';
const author = { id: 'alice', name: 'Alice' },
  now = new Date('2026-11-04T00:00:00Z');
const base = {
  version: '2.0' as const,
  workspaceId: 'test',
  transactionId: '1',
  expectRevision: '1',
};
const command = (p: Record<string, unknown>) => ({ ...base, ...p }) as ReviewWrite;
const fixture = () => {
  const a = new OpcArchive();
  const put = (part: string, xml: string) =>
    a.setPart(part, new TextEncoder().encode(xml), 'application/xml');
  put(
    '/ppt/presentation.xml',
    `<p:presentation xmlns:p="${NS.p}" xmlns:r="${NS.r}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
  );
  const slide = `<p:sld xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Shape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Hello world</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  put('/ppt/slides/slide1.xml', slide);
  put('/ppt/slides/slide2.xml', slide);
  a.setRelationships(
    '/ppt/presentation.xml',
    [1, 2].map((n) => ({
      id: `rId${n}`,
      type: REL.slide,
      target: `slides/slide${n}.xml`,
      resolvedTarget: `/ppt/slides/slide${n}.xml`,
      external: false,
    })),
  );
  return { a, index: buildIndex(a, 'test', '1') };
};
describe('PowerPoint comment workflow', () => {
  it('creates native threads, replies, updates, resolves, reopens and deletes', () => {
    const { a, index } = fixture();
    const added = mutateSlideComments(
      a,
      index,
      command({ type: 'addComment', author, text: 'First\nSecond', anchor: { target: 'slide:1' } }),
      now,
    );
    const id = String(added['id']);
    expect(slideComments(a)[0]).toMatchObject({
      text: 'First\nSecond',
      format: 'modern',
      resolved: false,
    });
    mutateSlideComments(
      a,
      index,
      command({ type: 'replyComment', id, author, text: 'reply' }),
      now,
    );
    expect(slideComments(a)[1]?.parentId).toBe(id);
    mutateSlideComments(a, index, command({ type: 'updateComment', id, text: 'changed' }), now);
    expect(slideComments(a)[0]?.text).toBe('changed');
    mutateSlideComments(a, index, command({ type: 'resolveComment', id }), now);
    expect(slideComments(a)[0]?.resolved).toBe(true);
    expect(() =>
      mutateSlideComments(
        a,
        index,
        command({ type: 'replyComment', id, author, text: 'blocked' }),
        now,
      ),
    ).toThrow('Reopen');
    mutateSlideComments(a, index, command({ type: 'reopenComment', id }), now);
    expect(() =>
      mutateSlideComments(a, index, command({ type: 'deleteComment', id }), now),
    ).toThrow('thread');
    mutateSlideComments(a, index, command({ type: 'deleteComment', id, thread: true }), now);
    expect(slideComments(a)).toHaveLength(0);
  });
  it('preserves legacy data until an explicit upgrade', () => {
    const { a, index } = fixture();
    mutateSlideComments(
      a,
      index,
      command({
        type: 'addComment',
        format: 'legacy',
        author,
        text: 'old',
        anchor: { target: 'slide:1', x: 10, y: 20 },
      }),
      now,
    );
    const old = slideComments(a)[0]!;
    expect(old.resolved).toBeNull();
    expect(() =>
      mutateSlideComments(a, index, command({ type: 'resolveComment', id: old.id }), now),
    ).toThrow('Upgrade');
    const upgraded = mutateSlideComments(a, index, command({ type: 'upgradeComments' }), now);
    expect(upgraded['mapping']).toHaveProperty(old.id);
    expect(slideComments(a)).toHaveLength(1);
    expect(slideComments(a)[0]).toMatchObject({ text: 'old', format: 'modern' });
  });
  it('protects text anchors and clones threads independently', () => {
    const { a, index } = fixture();
    const shape = index.elements.find((n) => n.kind === 'shape' || n.kind === 'textbox')!;
    mutateSlideComments(
      a,
      index,
      command({
        type: 'addComment',
        author,
        text: 'text anchor',
        anchor: {
          target: 'slide:1/shape:2',
          start: { target: 'slide:1/shape:2', offset: 0 },
          end: { target: 'slide:1/shape:2', offset: 5 },
        },
      }),
      now,
    );
    expect(() => guardCommentMutation(a, shape, 'setText')).toThrow('anchor');
    const rels = a.getRelationships('/ppt/slides/slide1.xml');
    a.setRelationships('/ppt/slides/slide2.xml', rels);
    cloneSlideComments(a, '/ppt/slides/slide1.xml', '/ppt/slides/slide2.xml');
    const comments = slideComments(a);
    expect(comments).toHaveLength(2);
    expect(comments[0]?.id).not.toBe(comments[1]?.id);
    mutateSlideComments(
      a,
      index,
      command({ type: 'updateComment', id: comments[1]!.id, text: 'copy' }),
      now,
    );
    expect(slideComments(a)[0]?.text).toBe('text anchor');
  });
});
