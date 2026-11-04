import type { Document, Element } from '@xmldom/xmldom';
import { parseXml, type OpcArchive } from '../opc/index.js';
import type { ReviewWrite, CommentAnchor, ReviewAuthor } from '../review/schema.js';
import type { NativeComment } from '../docx/comments.js';
import {
  all,
  elements,
  make,
  guid,
  rel,
  remove,
  root,
  checkedOffset,
  relatedPart,
} from '../review/xml.js';
import { NS } from './xml.js';
import { resolveTarget, cNvPrIdOf } from './addressing.js';
import { nodeFor } from './node-for.js';
import type { IndexFile, IndexedElement } from './types.js';
export const MODERN = 'http://schemas.microsoft.com/office/powerpoint/2018/8/main';
const PC = 'http://schemas.microsoft.com/office/powerpoint/2013/main/command';
const AC = 'http://schemas.microsoft.com/office/drawing/2013/main/command';
export const COMMENT_RELS = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
  'http://schemas.microsoft.com/office/2018/10/relationships/comments',
]);
const modernRel = 'http://schemas.microsoft.com/office/2018/10/relationships/comments';
const authorsRel = 'http://schemas.microsoft.com/office/2018/10/relationships/authors';
const idFor = (part: string, id: string): string =>
  `comment:${encodeURIComponent(part)}:${encodeURIComponent(id)}`;
const legacyNative = (n: Element): string =>
  `${n.getAttribute('authorId') ?? ''}/${n.getAttribute('idx') ?? ''}`;
const bodyText = (n: Element, ns: string): string => {
  const body = elements(n).find(
    (c) => c.namespaceURI === ns && (c.localName === 'txBody' || c.localName === 'text'),
  );
  return body
    ? all(body, NS.a, 'p')
        .map((p) =>
          all(p, NS.a, 't')
            .map((t) => t.textContent ?? '')
            .join(''),
        )
        .join('\n') ||
        (body.textContent ?? '') ||
        ''
    : '';
};
export const slideComments = (archive: OpcArchive): NativeComment[] => {
  const items: NativeComment[] = [];
  for (const [slide, rels] of archive.relationships) {
    if (!/^\/ppt\/slides\/[^/]+\.xml$/.test(slide)) continue;
    for (const r of rels) {
      if (!COMMENT_RELS.has(r.type) || !r.resolvedTarget || !archive.getPart(r.resolvedTarget))
        continue;
      const part = r.resolvedTarget;
      const doc = archive.readXml(part);
      const modern = root(doc).namespaceURI === MODERN;
      const ns = modern ? MODERN : NS.p;
      const authorPart = relatedPart(
        archive,
        '/ppt/presentation.xml',
        modern
          ? authorsRel
          : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors',
        modern ? '/ppt/authors.xml' : '/ppt/commentAuthors.xml',
      );
      const authors = archive.getPart(authorPart)
        ? all(archive.readXml(authorPart), ns, modern ? 'author' : 'cmAuthor')
        : [];
      for (const node of all(doc, ns).filter(
        (n) => n.localName === 'cm' || (modern && n.localName === 'reply'),
      )) {
        const id = idFor(part, modern ? (node.getAttribute('id') ?? '') : legacyNative(node));
        const parent =
          node.localName === 'reply' ? (node.parentNode?.parentNode as Element) : undefined;
        const parentId = parent ? idFor(part, parent.getAttribute('id') ?? '') : undefined;
        const owner = parent ?? node;
        const aid = node.getAttribute('authorId') ?? '';
        const author = authors.find((n) => n.getAttribute('id') === aid);
        const mk = all(owner, AC).find((n) =>
          ['spMk', 'picMk', 'graphicFrameMk', 'cxnSpMk', 'grpSpMk'].includes(n.localName ?? ''),
        );
        const tx = all(owner, AC, 'txMk')[0];
        const status = owner.getAttribute('status');
        const slideMoniker = all(owner, PC, 'sldMk')[0];
        const sourceRid = archive
          .getRelationships('/ppt/presentation.xml')
          .find((r) => r.resolvedTarget === slide)?.id;
        const expectedId =
          sourceRid &&
          all(archive.readXml('/ppt/presentation.xml'), NS.p, 'sldId')
            .find((n) => n.getAttributeNS(NS.r, 'id') === sourceRid)
            ?.getAttribute('id');
        const shapeExists =
          !mk ||
          all(archive.readXml(slide), NS.p, 'cNvPr').some(
            (n) => n.getAttribute('id') === mk.getAttribute('id'),
          );
        const knownAnchor =
          elements(owner).some((n) => n.namespaceURI === PC && n.localName === 'sldMkLst') ||
          Boolean(mk);
        const anchorResolved =
          !modern ||
          Boolean(
            slideMoniker &&
            slideMoniker.getAttribute('sldId') === expectedId &&
            shapeExists &&
            knownAnchor &&
            !all(owner, MODERN, 'unknownAnchor').length,
          );

        items.push({
          id,
          parentId,
          threadId: parentId ?? id,
          author: {
            id: author?.getAttribute('userId') ?? aid,
            name: author?.getAttribute('name') ?? '',
          },
          text: modern
            ? bodyText(node, MODERN)
            : (elements(node).find((n) => n.localName === 'text')?.textContent ?? ''),
          createdAt: node.getAttribute(modern ? 'created' : 'dt') ?? undefined,
          format: modern ? 'modern' : 'legacy',
          resolved: modern
            ? status === 'resolved'
              ? true
              : !status || status === 'active'
                ? false
                : null
            : null,
          anchor: {
            status: anchorResolved ? 'resolved' : 'unresolved',
            partUri: slide,
            ...(mk ? { shapeId: mk.getAttribute('id') } : {}),
            ...(tx
              ? { start: Number(tx.getAttribute('cp')), length: Number(tx.getAttribute('len')) }
              : {}),
          },
          capabilities: { update: true, reply: modern, resolve: modern, delete: true },
        });
      }
    }
  }
  return items;
};
const writeBody = (doc: Document, n: Element, text: string, modern: boolean): void => {
  const ns = modern ? MODERN : NS.p;
  const old = elements(n).find(
    (c) => c.namespaceURI === ns && c.localName === (modern ? 'txBody' : 'text'),
  );
  if (old) remove(old);
  if (!modern) {
    const t = make(doc, NS.p, 'p:text');
    t.textContent = text;
    n.appendChild(t);
    return;
  }
  const tx = make(doc, MODERN, 'p188:txBody');
  tx.appendChild(make(doc, NS.a, 'a:bodyPr'));
  tx.appendChild(make(doc, NS.a, 'a:lstStyle'));
  for (const line of text.split('\n')) {
    const p = make(doc, NS.a, 'a:p'),
      r = make(doc, NS.a, 'a:r'),
      t = make(doc, NS.a, 'a:t');
    t.textContent = line;
    r.appendChild(t);
    p.appendChild(r);
    tx.appendChild(p);
  }
  const ext = elements(n).find((c) => c.localName === 'extLst');
  n.insertBefore(tx, ext ?? null);
};
const nextLegacyIndex = (archive: OpcArchive, aid: string): string => {
  let highest = 0;
  for (const [part, data] of archive.parts) {
    if (
      data.mediaType === 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml'
    )
      for (const n of all(archive.readXml(part), NS.p, 'cm'))
        if (n.getAttribute('authorId') === aid)
          highest = Math.max(highest, Number(n.getAttribute('idx') ?? 0));
  }
  const authors = archive.readXml('/ppt/commentAuthors.xml');
  const author = all(authors, NS.p, 'cmAuthor').find((n) => n.getAttribute('id') === aid);
  highest = Math.max(highest, Number(author?.getAttribute('lastIdx') ?? 0)) + 1;
  if (author) author.setAttribute('lastIdx', String(highest));
  archive.writeXml('/ppt/commentAuthors.xml', authors);
  return String(highest);
};
const authorId = (archive: OpcArchive, author: ReviewAuthor, modern: boolean): string => {
  const part = relatedPart(
      archive,
      '/ppt/presentation.xml',
      modern
        ? authorsRel
        : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors',
      modern ? '/ppt/authors.xml' : '/ppt/commentAuthors.xml',
    ),
    ns = modern ? MODERN : NS.p;
  const doc = archive.getPart(part)
    ? archive.readXml(part)
    : parseXml(
        modern ? `<p188:authorLst xmlns:p188="${MODERN}"/>` : `<p:cmAuthorLst xmlns:p="${NS.p}"/>`,
      );
  if (
    root(doc).namespaceURI !== ns ||
    root(doc).localName !== (modern ? 'authorLst' : 'cmAuthorLst')
  )
    throw new Error('Author part has an unsupported root');
  const authors = all(doc, ns, modern ? 'author' : 'cmAuthor');
  let found = authors.find((n) =>
    modern ? n.getAttribute('userId') === author.id : n.getAttribute('name') === author.name,
  );
  if (!found) {
    found = make(doc, ns, modern ? 'p188:author' : 'p:cmAuthor', {
      id: modern
        ? guid()
        : String(Math.max(-1, ...authors.map((n) => Number(n.getAttribute('id')))) + 1),
      name: author.name,
      initials: author.initials ?? '',
    });
    if (modern) {
      found.setAttribute('userId', author.id);
      found.setAttribute('providerId', 'None');
    } else {
      found.setAttribute('lastIdx', '0');
      found.setAttribute('clrIdx', found.getAttribute('id') ?? '0');
    }
    root(doc).appendChild(found);
  }
  archive.writeXml(
    part,
    doc,
    modern
      ? 'application/vnd.ms-powerpoint.authors+xml'
      : 'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml',
  );
  rel(
    archive,
    '/ppt/presentation.xml',
    part,
    modern
      ? authorsRel
      : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors',
  );
  return found.getAttribute('id') ?? '';
};
const addAnchor = (
  archive: OpcArchive,
  doc: Document,
  n: Element,
  anchor: CommentAnchor,
  item: IndexedElement,
  index: IndexFile,
): void => {
  const list = make(
    doc,
    item.kind === 'slide' ? PC : AC,
    item.kind === 'slide' ? 'pc:sldMkLst' : anchor.start ? 'ac:txMkLst' : 'ac:deMkLst',
  );
  list.appendChild(make(doc, PC, 'pc:docMk'));
  list.appendChild(make(doc, PC, 'pc:sldMk', { cId: '0', sldId: item.slideId ?? '' }));
  if (item.kind !== 'slide') {
    const shape = nodeFor(archive.readXml(item.partUri), item);
    if (!shape) throw new Error('Comment shape not found');
    const names: Record<string, string> = {
      sp: 'spMk',
      pic: 'picMk',
      graphicFrame: 'graphicFrameMk',
      cxnSp: 'cxnSpMk',
      grpSp: 'grpSpMk',
    };
    const name = names[shape.localName ?? ''];
    if (!name) throw new Error('Unsupported shape anchor');
    list.appendChild(
      make(doc, AC, `ac:${name}`, {
        id: cNvPrIdOf(item) ?? '',
        creationId:
          all(shape, undefined, 'creationId')[0]?.getAttribute('id') ??
          '{00000000-0000-0000-0000-000000000000}',
      }),
    );
    if (anchor.start && anchor.end) {
      for (const endpoint of [anchor.start, anchor.end]) {
        const resolved = resolveTarget(index, endpoint.target);
        if (!resolved.ok || resolved.value.item.ref.elementId !== item.ref.elementId)
          throw new Error('Text anchor endpoints must identify the anchored shape');
      }
      const text = all(shape, NS.a, 'p')
        .map((p) =>
          all(p, NS.a, 't')
            .map((t) => t.textContent ?? '')
            .join(''),
        )
        .join('\r');
      checkedOffset(text, anchor.start.offset);
      checkedOffset(text, anchor.end.offset);
      if (anchor.start.offset > anchor.end.offset) throw new Error('Reversed text anchor');
      list.appendChild(
        make(doc, AC, 'ac:txMk', {
          cp: String(anchor.start.offset),
          len: String(anchor.end.offset - anchor.start.offset),
        }),
      );
    }
  }
  n.appendChild(list);
  if (anchor.x !== undefined || anchor.y !== undefined)
    n.appendChild(
      make(doc, MODERN, 'p188:pos', { x: String(anchor.x ?? 0), y: String(anchor.y ?? 0) }),
    );
};
export const mutateSlideComments = (
  archive: OpcArchive,
  index: IndexFile,
  command: ReviewWrite,
  now: Date,
): Record<string, unknown> => {
  if (command.type === 'upgradeComments') return upgrade(archive, index, now);
  const items = slideComments(archive);
  const existing = 'id' in command ? items.find((n) => n.id === command.id) : undefined;
  if ('id' in command && !existing) throw new Error('Comment not found');
  let item: IndexedElement | undefined;
  let part: string | undefined;
  let modern = existing?.format === 'modern';
  if (command.type === 'addComment') {
    const resolved = resolveTarget(index, command.anchor.target);
    if (!resolved.ok) throw new Error(resolved.error.message);
    item = resolved.value.item;
    const formats = new Set(items.map((n) => n.format));
    if (formats.size > 1 && !command.format)
      throw new Error('Mixed comments require an explicit format');
    modern = (command.format ?? (formats.has('legacy') ? 'legacy' : 'modern')) === 'modern';
    part = archive
      .getRelationships(item.partUri)
      .find(
        (r) =>
          r.type ===
          (modern
            ? modernRel
            : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'),
      )?.resolvedTarget;
    if (!part) {
      let i = 1;
      while (
        archive.getPart(`/ppt/comments/${modern ? 'modernComment' : 'comment'}${String(i)}.xml`)
      )
        i++;
      part = `/ppt/comments/${modern ? 'modernComment' : 'comment'}${String(i)}.xml`;
    }
  } else if (existing) {
    part = decodeURIComponent(existing.id.split(':')[1] ?? '');
  }
  if (!part) throw new Error('Comment part missing');
  const ns = modern ? MODERN : NS.p;
  const doc = archive.getPart(part)
    ? archive.readXml(part)
    : parseXml(
        `<${modern ? 'p188' : 'p'}:cmLst xmlns:${modern ? 'p188' : 'p'}="${ns}" xmlns:a="${NS.a}"/>`,
      );
  const node = existing
    ? all(doc, ns).find(
        (n) =>
          ['cm', 'reply'].includes(n.localName ?? '') &&
          idFor(part, modern ? (n.getAttribute('id') ?? '') : legacyNative(n)) === existing.id,
      )
    : undefined;
  let resultId = existing?.id;
  if (command.type === 'addComment' || command.type === 'replyComment') {
    if (command.type === 'replyComment' && !modern)
      throw new Error('Upgrade traditional comments before replying');
    if (
      command.type === 'replyComment' &&
      items.find((n) => n.id === existing?.threadId)?.resolved !== false
    )
      throw new Error('Reopen thread before replying');
    const aid = authorId(archive, command.author, modern);
    const native = modern ? guid() : nextLegacyIndex(archive, aid);
    const n = make(
      doc,
      ns,
      modern ? (command.type === 'replyComment' ? 'p188:reply' : 'p188:cm') : 'p:cm',
      {
        [modern ? 'id' : 'idx']: native,
        authorId: aid,
        [modern ? 'created' : 'dt']: now.toISOString(),
      },
    );
    if (command.type === 'replyComment') {
      const rootNode = all(doc, MODERN, 'cm').find(
        (n) => idFor(part, n.getAttribute('id') ?? '') === existing?.threadId,
      );
      if (!rootNode) throw new Error('Thread root missing');
      let replies = elements(rootNode).find((n) => n.localName === 'replyLst');
      if (!replies) {
        replies = make(doc, MODERN, 'p188:replyLst');
        rootNode.insertBefore(
          replies,
          elements(rootNode).find((n) => n.localName === 'txBody') ?? null,
        );
      }
      replies.appendChild(n);
    } else {
      if (!item) throw new Error('Comment anchor missing');
      if (modern) addAnchor(archive, doc, n, command.anchor, item, index);
      else {
        if (item.kind !== 'slide' || command.anchor.start)
          throw new Error('Legacy comments support slide position anchors only');
        n.appendChild(
          make(doc, NS.p, 'p:pos', {
            x: String(command.anchor.x ?? 0),
            y: String(command.anchor.y ?? 0),
          }),
        );
      }
      root(doc).appendChild(n);
      rel(
        archive,
        item.partUri,
        part,
        modern
          ? modernRel
          : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
      );
    }
    writeBody(doc, n, command.text, modern);
    resultId = idFor(part, modern ? native : `${aid}/${native}`);
  } else if (node && existing) {
    if (command.type === 'updateComment') writeBody(doc, node, command.text, modern);
    if (command.type === 'resolveComment' || command.type === 'reopenComment') {
      if (!modern) throw new Error('Upgrade traditional comments before changing thread state');
      const thread = all(doc, MODERN, 'cm').find(
        (n) => idFor(part, n.getAttribute('id') ?? '') === existing.threadId,
      );
      if (!thread) throw new Error('Thread missing');
      thread.setAttribute('status', command.type === 'resolveComment' ? 'resolved' : 'active');
    }
    if (command.type === 'deleteComment') {
      if (!existing.parentId && !command.thread)
        throw new Error('Root deletion requires thread: true');
      if (command.thread) {
        const thread = all(doc, ns, 'cm').find(
          (n) =>
            idFor(part, modern ? (n.getAttribute('id') ?? '') : legacyNative(n)) ===
            existing.threadId,
        );
        if (thread) remove(thread);
      } else remove(node);
    }
  }
  archive.writeXml(
    part,
    doc,
    modern
      ? 'application/vnd.ms-powerpoint.comments+xml'
      : 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml',
  );
  return {
    changed: true,
    id: resultId,
    changedParts: [part],
    changedTargets: resultId ? [resultId] : [],
  };
};
const upgrade = (archive: OpcArchive, index: IndexFile, now: Date): Record<string, unknown> => {
  const legacy = slideComments(archive).filter((n) => n.format === 'legacy');
  const mapping: Record<string, string> = {};
  for (const item of legacy) {
    const part = decodeURIComponent(item.id.split(':')[1] ?? '');
    const doc = archive.readXml(part);
    const node = all(doc, NS.p, 'cm').find((n) => idFor(part, legacyNative(n)) === item.id);
    if (!node) throw new Error('Legacy comment missing');
    if (elements(node).some((n) => !['pos', 'text'].includes(n.localName ?? '')))
      throw new Error('Cannot upgrade unknown legacy comment extensions');
    const slide = index.elements.find(
      (n) => n.kind === 'slide' && n.partUri === item.anchor['partUri'],
    );
    if (!slide) throw new Error('Legacy slide anchor cannot be resolved');
    const pos = elements(node).find((n) => n.localName === 'pos');
    const target = `slide:${String(index.elements.filter((n) => n.kind === 'slide').indexOf(slide) + 1)}`;
    const value = mutateSlideComments(
      archive,
      index,
      {
        type: 'addComment',
        version: '2.0',
        workspaceId: 'upgrade',
        transactionId: 'upgrade',
        expectRevision: index.revision,
        format: 'modern',
        author: { id: item.author.id, name: item.author.name },
        text: item.text,
        anchor: {
          target,
          x: Number(pos?.getAttribute('x') ?? 0),
          y: Number(pos?.getAttribute('y') ?? 0),
        },
      },
      item.createdAt ? new Date(item.createdAt) : now,
    );
    mapping[item.id] = String(value['id']);
  }
  const parts = new Set(legacy.map((n) => decodeURIComponent(n.id.split(':')[1] ?? '')));
  for (const [source, rels] of archive.relationships) {
    const next = rels.filter((r) => !r.resolvedTarget || !parts.has(r.resolvedTarget));
    if (next.length !== rels.length) archive.setRelationships(source, next);
  }
  for (const part of parts) archive.deletePart(part);
  return {
    changed: legacy.length > 0,
    mapping,
    changedParts: [...parts],
    changedTargets: Object.values(mapping),
  };
};
const targetShapeIds = (archive: OpcArchive, item: IndexedElement): Set<string> => {
  const ids = new Set<string>();
  const own = cNvPrIdOf(item);
  if (own) ids.add(own);
  if (item.kind === 'group') {
    const n = nodeFor(archive.readXml(item.partUri), item);
    if (n)
      for (const c of all(n, NS.p, 'cNvPr')) {
        const id = c.getAttribute('id');
        if (id) ids.add(id);
      }
  }
  return ids;
};
export const guardCommentMutation = (
  archive: OpcArchive,
  item: IndexedElement,
  type: string,
): void => {
  if (!['remove', 'setText', 'replaceText', 'set', 'setProperties', 'duplicate'].includes(type))
    return;
  const comments = slideComments(archive).filter((n) => n.anchor['partUri'] === item.partUri);
  const shapeIds = targetShapeIds(archive, item);
  const anchored = comments.filter(
    (n) =>
      item.kind === 'slide' ||
      shapeIds.has(String(n.anchor['shapeId'])) ||
      n.anchor['status'] === 'unresolved',
  );
  if (type === 'remove' && anchored.length)
    throw new Error('Target has comments; delete the comment threads first');
  if (
    ['setText', 'replaceText', 'set', 'setProperties'].includes(type) &&
    anchored.some((n) => n.anchor['start'] !== undefined)
  )
    throw new Error('Text edit may invalidate a comment anchor');
  if (type === 'duplicate' && item.kind !== 'slide' && anchored.length)
    throw new Error('Object duplication with comments requires explicit anchor handling');
};
export const cloneSlideComments = (archive: OpcArchive, source: string, target: string): void => {
  if (
    slideComments(archive).some(
      (n) => n.anchor['partUri'] === source && n.anchor['status'] === 'unresolved',
    )
  )
    throw new Error('Unknown comment anchor cannot be cloned safely');
  const presentation = archive.readXml('/ppt/presentation.xml');
  const presentationRels = archive.getRelationships('/ppt/presentation.xml');
  const targetRid = presentationRels.find((r) => r.resolvedTarget === target)?.id;
  const slideId = all(presentation, NS.p, 'sldId')
    .find((n) => n.getAttributeNS(NS.r, 'id') === targetRid)
    ?.getAttribute('id');
  if (!slideId) throw new Error('Cloned slide identifier missing');
  const rels = [...archive.getRelationships(target)];
  for (let i = 0; i < rels.length; i++) {
    const r = rels[i];
    if (!r || !COMMENT_RELS.has(r.type) || !r.resolvedTarget) continue;
    const old = r.resolvedTarget;
    const doc = archive.readXml(old);
    const modern = root(doc).namespaceURI === MODERN;
    if (
      !modern &&
      all(doc, NS.p, 'cm').some((n) =>
        elements(n).some((c) => !['pos', 'text'].includes(c.localName ?? '')),
      )
    )
      throw new Error('Unknown comment anchor cannot be cloned');
    if (!modern)
      for (const n of all(doc, NS.p, 'cm'))
        n.setAttribute('idx', nextLegacyIndex(archive, n.getAttribute('authorId') ?? ''));
    if (modern) {
      for (const n of all(doc, MODERN).filter((n) => ['cm', 'reply'].includes(n.localName ?? '')))
        n.setAttribute('id', guid());
      for (const n of all(doc, PC, 'sldMk')) n.setAttribute('sldId', slideId);
      if (all(doc, MODERN, 'unknownAnchor').length)
        throw new Error('Unknown comment anchor cannot be cloned');
    }
    let suffix = 1;
    let fresh = `/ppt/comments/clone${String(suffix)}.xml`;
    while (archive.getPart(fresh)) fresh = `/ppt/comments/clone${String(++suffix)}.xml`;
    archive.writeXml(fresh, doc, archive.getPart(old)?.mediaType);
    if (archive.getRelationships(old).length)
      archive.setRelationships(fresh, archive.getRelationships(old));
    rels[i] = {
      ...r,
      target: '../comments/' + (fresh.split('/').at(-1) ?? ''),
      resolvedTarget: fresh,
    };
  }
  archive.setRelationships(target, rels);
};

export const deleteTargetComments = (
  archive: OpcArchive,
  index: IndexFile,
  item: IndexedElement,
): void => {
  if (
    item.kind !== 'slide' &&
    slideComments(archive).some(
      (n) => n.anchor['partUri'] === item.partUri && n.anchor['status'] === 'unresolved',
    )
  )
    throw new Error('Unknown comment anchors must be explicitly deleted first');
  const ids = new Set(
    slideComments(archive)
      .filter(
        (n) =>
          n.anchor['partUri'] === item.partUri &&
          (item.kind === 'slide' || targetShapeIds(archive, item).has(String(n.anchor['shapeId']))),
      )
      .map((n) => n.threadId),
  );
  for (const id of ids)
    mutateSlideComments(
      archive,
      index,
      {
        version: '2.0',
        workspaceId: 'delete',
        transactionId: 'delete',
        expectRevision: index.revision,
        type: 'deleteComment',
        id,
        thread: true,
      },
      new Date(),
    );
};
