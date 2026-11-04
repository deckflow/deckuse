import { hitsFrom } from './indexer.js';
import type { Element, Document } from '@xmldom/xmldom';
import { randomInt } from 'node:crypto';
import { parseXml, type OpcArchive } from '../opc/index.js';
import type { ReviewWrite, CommentAnchor } from '../review/schema.js';
import { all, elements, make, rel, remove, root, relatedPart } from '../review/xml.js';
import { NS, DOCUMENT_PART, ensureW14 } from './xml.js';
import { paragraphAt, assertPlain, boundary, plainText } from './review-text.js';
const C = '/word/comments.xml',
  E = '/word/commentsExtended.xml';
const CID = 'http://schemas.microsoft.com/office/word/2016/wordml/cid';
const CEX = 'http://schemas.microsoft.com/office/word/2018/wordml/cex';
const IDS = '/word/commentsIds.xml',
  EXTENSIBLE = '/word/commentsExtensible.xml',
  PEOPLE = '/word/people.xml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const ER = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const ECT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml';
const wordParts = (archive: OpcArchive) => ({
  comments: relatedPart(archive, DOCUMENT_PART, R, C),
  extended: relatedPart(archive, DOCUMENT_PART, ER, E),
  ids: relatedPart(
    archive,
    DOCUMENT_PART,
    'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds',
    IDS,
  ),
  extensible: relatedPart(
    archive,
    DOCUMENT_PART,
    'http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible',
    EXTENSIBLE,
  ),
  people: relatedPart(
    archive,
    DOCUMENT_PART,
    'http://schemas.microsoft.com/office/2011/relationships/people',
    PEOPLE,
  ),
});
const lastPara = (n: Element): string =>
  all(n, NS.w, 'p').at(-1)?.getAttributeNS(NS.w14, 'paraId') ?? '';
const pid = (): string => randomInt(1, 0x7fffffff).toString(16).toUpperCase().padStart(8, '0');
const parseDone = (value: string): boolean | null =>
  ['1', 'true', 'on'].includes(value) ? true : ['0', 'false', 'off'].includes(value) ? false : null;
export interface NativeComment {
  id: string;
  threadId: string;
  parentId?: string | undefined;
  text: string;
  author: { id: string; name: string };
  createdAt?: string | undefined;
  format: string;
  resolved: boolean | null;
  anchor: Record<string, unknown>;
  capabilities: { update: boolean; reply: boolean; resolve: boolean; delete: boolean };
}
const idFor = (part: string, id: string): string =>
  `comment:${encodeURIComponent(part)}:${encodeURIComponent(id)}`;
export const wordComments = (archive: OpcArchive): NativeComment[] => {
  const { comments: C, extended: E, people: PEOPLE } = wordParts(archive);
  const ext = archive.getPart(E) ? archive.readXml(E) : undefined;
  const people = archive.getPart(PEOPLE) ? all(archive.readXml(PEOPLE), W15, 'person') : [];
  const result: NativeComment[] = [];
  for (const [part, data] of archive.parts) {
    if (!data.mediaType.includes('comments+xml')) continue;
    const doc = archive.readXml(part);
    if (root(doc).namespaceURI !== NS.w) continue;
    const comments = all(doc, NS.w, 'comment');
    for (const node of comments) {
      const native = node.getAttributeNS(NS.w, 'id') ?? '';
      const id = idFor(part, native);
      const ex =
        ext &&
        all(ext, W15, 'commentEx').find((n) => n.getAttributeNS(W15, 'paraId') === lastPara(node));
      const parentPid = ex?.getAttributeNS(W15, 'paraIdParent');
      const parent = parentPid ? comments.find((n) => lastPara(n) === parentPid) : undefined;
      const parentId = parent ? idFor(part, parent.getAttributeNS(NS.w, 'id') ?? '') : undefined;
      const anchors: Record<string, unknown>[] = [];
      for (const [story, data] of archive.parts) {
        if (
          !story.startsWith('/word/') ||
          !data.mediaType.includes('xml') ||
          story === part ||
          story.endsWith('.rels')
        )
          continue;
        const xml = archive.readXml(story);
        for (const mark of all(xml, NS.w, 'commentRangeStart').filter(
          (n) => n.getAttributeNS(NS.w, 'id') === native,
        )) {
          const endpoint = (mark: Element): Record<string, unknown> => {
            let parent = mark.parentNode;
            while (parent?.nodeType === 1 && (parent as Element).localName !== 'p')
              parent = parent.parentNode;
            if (!parent) return {};
            const paragraph = parent as Element;
            let offset = 0;
            for (const n of all(paragraph, NS.w)) {
              if (n === mark) break;
              if (n.localName === 't') offset += (n.textContent ?? '').length;
            }
            const hit =
              story === DOCUMENT_PART
                ? hitsFrom(xml, undefined).find((h) => h.element === paragraph)
                : undefined;
            return { offset, ...(hit ? { target: hit.path } : {}) };
          };
          const ends = all(xml, NS.w, 'commentRangeEnd').filter(
            (n) => n.getAttributeNS(NS.w, 'id') === native,
          );
          const end = ends[0];
          anchors.push({
            partUri: story,
            nativeId: native,
            start: endpoint(mark),
            end: end ? endpoint(end) : null,
            resolved: ends.length === 1,
          });
        }
      }
      result.push({
        id,
        threadId: parentId ?? id,
        parentId,
        text: all(node, NS.w, 'p')
          .map((p) =>
            all(p, NS.w, 't')
              .map((t) => t.textContent ?? '')
              .join(''),
          )
          .join('\n'),
        author: {
          id:
            all(
              people.find(
                (n) => n.getAttributeNS(W15, 'author') === node.getAttributeNS(NS.w, 'author'),
              ) ?? node,
              W15,
              'presenceInfo',
            )[0]?.getAttributeNS(W15, 'userId') ??
            node.getAttributeNS(NS.w, 'author') ??
            '',
          name: node.getAttributeNS(NS.w, 'author') ?? '',
        },
        createdAt: node.getAttributeNS(NS.w, 'date') ?? undefined,
        format: 'docx',
        resolved: ex ? parseDone(ex.getAttributeNS(W15, 'done') ?? '0') : false,
        anchor: {
          status: anchors.length === 1 && anchors[0]?.['resolved'] ? 'resolved' : 'unresolved',
          ranges: anchors,
        },
        capabilities: {
          update: part === C,
          reply: part === C,
          resolve: part === C,
          delete: part === C,
        },
      });
    }
  }
  for (const item of result) {
    let p = result.find((n) => n.id === item.parentId);
    const seen = new Set<string>();
    while (p && !seen.has(p.id)) {
      seen.add(p.id);
      item.threadId = p.id;
      p = result.find((n) => n.id === p?.parentId);
    }
  }
  for (const item of result)
    if (item.parentId) {
      const thread = result.find((n) => n.id === item.threadId);
      if (thread) {
        item.anchor = thread.anchor;
        item.resolved = thread.resolved;
      }
    }
  for (const item of result) {
    const ranges = item.anchor['ranges'] as { partUri: string }[];
    const writable =
      item.anchor['status'] === 'resolved' && ranges.every((n) => n.partUri === DOCUMENT_PART);
    if (!writable)
      item.capabilities = { update: false, reply: false, resolve: false, delete: false };
  }
  if (!threadCompatible(archive)) for (const item of result) item.capabilities.reply = false;
  return result;
};
const addModernMetadata = (
  archive: OpcArchive,
  paragraphId: string,
  author: { id: string; name: string },
  now: Date,
): void => {
  const { ids: IDS, extensible: EXTENSIBLE, people: PEOPLE } = wordParts(archive);
  const ids = archive.getPart(IDS)
    ? archive.readXml(IDS)
    : parseXml(`<w16cid:commentsIds xmlns:w16cid="${CID}"/>`);
  const extended = archive.getPart(EXTENSIBLE)
    ? archive.readXml(EXTENSIBLE)
    : parseXml(`<w16cex:commentsExtensible xmlns:w16cex="${CEX}"/>`);
  let durable = pid();
  while (all(ids, CID, 'commentId').some((n) => n.getAttributeNS(CID, 'durableId') === durable))
    durable = pid();
  const id = make(ids, CID, 'w16cid:commentId');
  id.setAttributeNS(CID, 'w16cid:paraId', paragraphId);
  id.setAttributeNS(CID, 'w16cid:durableId', durable);
  root(ids).appendChild(id);
  const meta = make(extended, CEX, 'w16cex:commentExtensible');
  meta.setAttributeNS(CEX, 'w16cex:durableId', durable);
  meta.setAttributeNS(CEX, 'w16cex:dateUtc', now.toISOString());
  root(extended).appendChild(meta);
  const people = archive.getPart(PEOPLE)
    ? archive.readXml(PEOPLE)
    : parseXml(`<w15:people xmlns:w15="${W15}"/>`);
  const person = all(people, W15, 'person').find(
    (n) => n.getAttributeNS(W15, 'author') === author.name,
  );
  if (person) {
    const presence = all(person, W15, 'presenceInfo')[0];
    if (presence && presence.getAttributeNS(W15, 'userId') !== author.id)
      throw new Error('An existing author has the same display name with a different identity');
  } else {
    const person = make(people, W15, 'w15:person');
    person.setAttributeNS(W15, 'w15:author', author.name);
    const presence = make(people, W15, 'w15:presenceInfo');
    presence.setAttributeNS(W15, 'w15:providerId', 'None');
    presence.setAttributeNS(W15, 'w15:userId', author.id);
    person.appendChild(presence);
    root(people).appendChild(person);
  }
  archive.writeXml(
    IDS,
    ids,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml',
  );
  archive.writeXml(
    EXTENSIBLE,
    extended,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml',
  );
  archive.writeXml(
    PEOPLE,
    people,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml',
  );
  rel(
    archive,
    DOCUMENT_PART,
    IDS,
    'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds',
  );
  rel(
    archive,
    DOCUMENT_PART,
    EXTENSIBLE,
    'http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible',
  );
  rel(
    archive,
    DOCUMENT_PART,
    PEOPLE,
    'http://schemas.microsoft.com/office/2011/relationships/people',
  );
};
const removeModernMetadata = (archive: OpcArchive, paragraphId: string): void => {
  const { ids: IDS, extensible: EXTENSIBLE } = wordParts(archive);
  if (!archive.getPart(IDS)) return;
  const ids = archive.readXml(IDS);
  const removed = new Set<string>();
  for (const n of all(ids, CID, 'commentId'))
    if (n.getAttributeNS(CID, 'paraId') === paragraphId) {
      removed.add(n.getAttributeNS(CID, 'durableId') ?? '');
      remove(n);
    }
  archive.writeXml(IDS, ids);
  if (archive.getPart(EXTENSIBLE)) {
    const ext = archive.readXml(EXTENSIBLE);
    for (const n of all(ext, CEX, 'commentExtensible'))
      if (removed.has(n.getAttributeNS(CEX, 'durableId') ?? '')) remove(n);
    archive.writeXml(EXTENSIBLE, ext);
  }
};
const body = (doc: Document, node: Element, text: string): void => {
  const previous = lastPara(node);
  if (elements(node).some((n) => n.namespaceURI === NS.w && n.localName !== 'p'))
    throw new Error('Updating complex comment bodies is not supported');
  for (const n of elements(node)) if (n.namespaceURI === NS.w && n.localName === 'p') remove(n);
  const lines = text.split('\n');
  let lineIndex = 0;
  for (const line of lines) {
    const p = make(doc, NS.w, 'w:p');
    p.setAttributeNS(
      NS.w14,
      'w14:paraId',
      lineIndex++ === lines.length - 1 && previous ? previous : pid(),
    );
    const r = make(doc, NS.w, 'w:r');
    const t = make(doc, NS.w, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = line;
    r.appendChild(t);
    p.appendChild(r);
    node.appendChild(p);
  }
};
const insertAnchor = (doc: Document, anchor: CommentAnchor, native: string): void => {
  const start = anchor.start ?? { target: anchor.target, offset: 0 };
  const end = anchor.end ?? {
    target: anchor.target,
    offset: plainText(paragraphAt(doc, anchor.target)).length,
  };
  const p = paragraphAt(doc, start.target),
    q = paragraphAt(doc, end.target);
  assertPlain(p);
  if (q !== p) assertPlain(q);
  const cell = (n: Element): Element | undefined => {
    let a = n.parentNode;
    while (a?.nodeType === 1) {
      if ((a as Element).localName === 'tc') return a as Element;
      a = a.parentNode;
    }
    return undefined;
  };
  if (cell(p) !== cell(q)) throw new Error('Comment ranges cannot cross table cells');
  const ps = all(doc, NS.w, 'p');
  const a = ps.indexOf(p),
    b = ps.indexOf(q);
  if (a > b || (a === b && start.offset > end.offset))
    throw new Error('Range endpoints are reversed');
  for (const n of ps.slice(a, b + 1)) assertPlain(n);
  const finish = boundary(q, end.offset);
  const begin = boundary(p, start.offset);
  const sm = make(doc, NS.w, 'w:commentRangeStart');
  sm.setAttributeNS(NS.w, 'w:id', native);
  p.insertBefore(sm, begin);
  const em = make(doc, NS.w, 'w:commentRangeEnd');
  em.setAttributeNS(NS.w, 'w:id', native);
  q.insertBefore(em, finish);
  const rr = make(doc, NS.w, 'w:r');
  const ref = make(doc, NS.w, 'w:commentReference');
  ref.setAttributeNS(NS.w, 'w:id', native);
  rr.appendChild(ref);
  q.insertBefore(rr, em.nextSibling);
};
const compatibilityPart = (archive: OpcArchive) =>
  relatedPart(
    archive,
    DOCUMENT_PART,
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
    '/word/settings.xml',
  );
const threadCompatible = (archive: OpcArchive): boolean => {
  const part = compatibilityPart(archive);
  if (!archive.getPart(part)) return false;
  return all(archive.readXml(part), NS.w, 'compatSetting').some(
    (n) =>
      n.getAttributeNS(NS.w, 'name') === 'compatibilityMode' &&
      Number(n.getAttributeNS(NS.w, 'val')) >= 15,
  );
};
const upgradeWordComments = (archive: OpcArchive): Record<string, unknown> => {
  if (threadCompatible(archive)) return { changed: false, changedParts: [], changedTargets: [] };
  const part = compatibilityPart(archive);
  const doc = archive.getPart(part)
    ? archive.readXml(part)
    : parseXml(`<w:settings xmlns:w="${NS.w}"/>`);
  let compat = all(doc, NS.w, 'compat')[0];
  if (!compat) {
    compat = make(doc, NS.w, 'w:compat');
    root(doc).appendChild(compat);
  }
  let mode = all(compat, NS.w, 'compatSetting').find(
    (n) => n.getAttributeNS(NS.w, 'name') === 'compatibilityMode',
  );
  if (!mode) {
    mode = make(doc, NS.w, 'w:compatSetting');
    compat.appendChild(mode);
  }
  mode.setAttributeNS(NS.w, 'w:name', 'compatibilityMode');
  mode.setAttributeNS(NS.w, 'w:uri', 'http://schemas.microsoft.com/office/word');
  mode.setAttributeNS(NS.w, 'w:val', '15');
  archive.writeXml(
    part,
    doc,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  );
  rel(
    archive,
    DOCUMENT_PART,
    part,
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  );
  return { changed: true, changedParts: [part], changedTargets: [], compatibilityMode: 15 };
};
export const mutateWordComments = (
  archive: OpcArchive,
  command: ReviewWrite,
  now: Date,
): Record<string, unknown> => {
  const { comments: C, extended: E } = wordParts(archive);
  if (command.type === 'upgradeComments') return upgradeWordComments(archive);
  if (command.type === 'replyComment' && !threadCompatible(archive))
    throw new Error(
      'Word compatibility mode disables replies; use upgradeComments explicitly to enable modern threads',
    );
  const items = wordComments(archive);
  const existing = 'id' in command ? items.find((n) => n.id === command.id) : undefined;
  if ('id' in command && !existing) throw new Error('Comment not found');
  if (existing && !existing.capabilities.update) throw new Error('Comment part is read-only');
  const doc = archive.getPart(C)
    ? archive.readXml(C)
    : parseXml(`<w:comments xmlns:w="${NS.w}" xmlns:w14="${NS.w14}"/>`);
  const ext = archive.getPart(E)
    ? archive.readXml(E)
    : parseXml(`<w15:commentsEx xmlns:w15="${W15}"/>`);
  const node = existing
    ? all(doc, NS.w, 'comment').find(
        (n) => idFor(C, n.getAttributeNS(NS.w, 'id') ?? '') === existing.id,
      )
    : undefined;
  const exFor = (n: Element): Element => {
    let ex = all(ext, W15, 'commentEx').find(
      (e) => e.getAttributeNS(W15, 'paraId') === lastPara(n),
    );
    if (!ex) {
      ex = make(ext, W15, 'w15:commentEx');
      ex.setAttributeNS(W15, 'w15:paraId', lastPara(n));
      root(ext).appendChild(ex);
    }
    return ex;
  };
  let resultId = existing?.id;
  if (command.type === 'addComment' || command.type === 'replyComment') {
    if (
      command.type === 'replyComment' &&
      items.find((n) => n.id === existing?.threadId)?.resolved !== false
    )
      throw new Error('Reopen the thread before replying');
    const native = String(
      Math.max(-1, ...all(doc, NS.w, 'comment').map((n) => Number(n.getAttributeNS(NS.w, 'id')))) +
        1,
    );
    const n = make(doc, NS.w, 'w:comment');
    n.setAttributeNS(NS.w, 'w:id', native);
    n.setAttributeNS(NS.w, 'w:author', command.author.name);
    n.setAttributeNS(NS.w, 'w:initials', command.author.initials ?? '');
    n.setAttributeNS(NS.w, 'w:date', now.toISOString());
    body(doc, n, command.text);
    addModernMetadata(archive, lastPara(n), command.author, now);
    root(doc).appendChild(n);
    const ex = exFor(n);
    if (command.type === 'replyComment') {
      if (!node) throw new Error('Reply parent not found');
      ex.setAttributeNS(W15, 'w15:paraIdParent', lastPara(node));
      const parentNative = node.getAttributeNS(NS.w, 'id');
      const story = archive.readXml(DOCUMENT_PART);
      for (const kind of ['commentRangeStart', 'commentRangeEnd', 'commentReference']) {
        const matches = all(story, NS.w, kind).filter(
          (n) => n.getAttributeNS(NS.w, 'id') === parentNative,
        );
        if (matches.length !== 1) throw new Error('Reply requires an unambiguous body anchor');
        const original = matches[0];
        if (!original) throw new Error('Parent anchor missing');
        const copy = original.cloneNode(true) as Element;
        copy.setAttributeNS(NS.w, 'w:id', native);
        original.parentNode?.insertBefore(
          copy,
          kind === 'commentRangeEnd' ? original : original.nextSibling,
        );
      }
      archive.writeXml(DOCUMENT_PART, story);
    } else {
      const story = archive.readXml(DOCUMENT_PART);
      insertAnchor(story, command.anchor, native);
      archive.writeXml(DOCUMENT_PART, story);
    }
    resultId = idFor(C, native);
  } else if (node && existing) {
    if (command.type === 'updateComment') {
      const old = lastPara(node);
      const ex = exFor(node);
      body(doc, node, command.text);
      ex.setAttributeNS(W15, 'w15:paraId', lastPara(node));
      for (const child of all(ext, W15, 'commentEx'))
        if (child.getAttributeNS(W15, 'paraIdParent') === old)
          child.setAttributeNS(W15, 'w15:paraIdParent', lastPara(node));
    } else if (command.type === 'resolveComment' || command.type === 'reopenComment') {
      const root = all(doc, NS.w, 'comment').find(
        (n) => idFor(C, n.getAttributeNS(NS.w, 'id') ?? '') === existing.threadId,
      );
      if (!root) throw new Error('Thread root not found');
      exFor(root).setAttributeNS(W15, 'w15:done', command.type === 'resolveComment' ? '1' : '0');
    } else if (command.type === 'deleteComment') {
      if (!existing.parentId && !command.thread)
        throw new Error('Root deletion requires thread: true');
      if (existing.parentId && items.some((n) => n.parentId === existing.id))
        throw new Error('Cannot delete a reply with children');
      const deleted = command.thread
        ? items.filter((n) => n.threadId === existing.threadId)
        : [existing];
      for (const item of deleted) {
        const n = all(doc, NS.w, 'comment').find(
          (n) => idFor(C, n.getAttributeNS(NS.w, 'id') ?? '') === item.id,
        );
        if (!n) continue;
        const native = n.getAttributeNS(NS.w, 'id');
        const para = lastPara(n);
        removeModernMetadata(archive, para);
        remove(n);
        for (const e of all(ext, W15, 'commentEx'))
          if (e.getAttributeNS(W15, 'paraId') === para) remove(e);
        for (const [part, data] of archive.parts) {
          if (
            part === C ||
            !part.startsWith('/word/') ||
            !data.mediaType.includes('xml') ||
            part.endsWith('.rels')
          )
            continue;
          const xml = archive.readXml(part);
          let changed = false;
          for (const mark of all(xml, NS.w).filter(
            (n) =>
              ['commentRangeStart', 'commentRangeEnd', 'commentReference'].includes(
                n.localName ?? '',
              ) && n.getAttributeNS(NS.w, 'id') === native,
          )) {
            remove(mark);
            changed = true;
          }
          if (changed) archive.writeXml(part, xml);
        }
      }
    }
  }
  ensureW14(doc);
  archive.writeXml(C, doc, CT);
  archive.writeXml(E, ext, ECT);
  rel(archive, DOCUMENT_PART, C, R);
  rel(archive, DOCUMENT_PART, E, ER);
  return {
    changed: true,
    id: resultId,
    changedParts: [C, E, DOCUMENT_PART],
    changedTargets: resultId ? [resultId] : [],
  };
};
