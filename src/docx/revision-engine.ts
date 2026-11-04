import { createHash } from 'node:crypto';
import type { Document, Element } from '@xmldom/xmldom';
import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml, type OpcArchive } from '../opc/index.js';
import type { ProposalOperation, ReviewWrite, ReviewAuthor } from '../review/schema.js';
import { all, elements, make, remove, unwrap, rel, root } from '../review/xml.js';
import { NS, DOCUMENT_PART, protectionReason } from './xml.js';
import { scanRevisions, REVISION_NAMES, isRevisionMarkup } from './revisions.js';
import { assertPlain, boundary, paragraphAt, plainText, textRun } from './review-text.js';
import { applyProperties } from './properties.js';
import { hitsFrom } from './indexer.js';
import { supportedRevision as supported, inWritableBodyStory } from './revision-support.js';
const propsNames = new Set([
  'rPrChange',
  'pPrChange',
  'tblPrChange',
  'tblPrExChange',
  'trPrChange',
  'tcPrChange',
  'tblGridChange',
  'sectPrChange',
]);
const GROUP_PART = '/customXml/deckuseReview.xml';
const GROUP_NS = 'https://deckflow.com/deckuse/review/1';
const groupPart = (archive: OpcArchive): string => {
  const candidates = archive
    .getRelationships(DOCUMENT_PART)
    .filter(
      (r) =>
        r.type ===
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml' &&
        r.resolvedTarget &&
        archive.getPart(r.resolvedTarget),
    )
    .flatMap((r) =>
      r.resolvedTarget && root(archive.readXml(r.resolvedTarget)).namespaceURI === GROUP_NS
        ? [r.resolvedTarget]
        : [],
    );
  if (candidates.length > 1) throw new Error('Multiple native review group parts are ambiguous');
  return candidates[0] ?? GROUP_PART;
};
const allocations = new WeakMap<Document, { next: number; groups: Map<string, string[]> }>();
const readGroups = (archive: OpcArchive): string[][] =>
  archive.getPart(groupPart(archive))
    ? all(archive.readXml(groupPart(archive)), GROUP_NS, 'group').map((n) =>
        (n.getAttribute('ids') ?? '').split(' ').filter(Boolean),
      )
    : [];
const moveGroups = (archive: OpcArchive): string[][] => {
  const named = new Map<string, Set<string>>();
  for (const [part, data] of archive.parts) {
    if (!part.startsWith('/word/') || !data.mediaType.includes('xml') || part.endsWith('.rels'))
      continue;
    const active = new Map<string, { name: string; id: string }>();
    for (const n of all(archive.readXml(part), NS.w)) {
      const type = n.localName ?? '';
      const id = n.getAttributeNS(NS.w, 'id') ?? '';
      if (/^(moveFrom|moveTo)RangeStart$/.test(type)) {
        const name = part + ':' + (n.getAttributeNS(NS.w, 'name') ?? id);
        active.set(type.replace('RangeStart', ''), { name, id });
        const group = named.get(name) ?? new Set<string>();
        group.add(id);
        named.set(name, group);
      }
      for (const current of active.values())
        if (REVISION_NAMES.has(type) && id) named.get(current.name)?.add(id);
      if (/^(moveFrom|moveTo)RangeEnd$/.test(type)) active.delete(type.replace('RangeEnd', ''));
    }
  }
  return [...named.values()].map((s) => [...s]);
};
const groupFingerprint = (doc: Document, members: string[]): string => {
  const canonical = (node: Element): unknown => ({
    ns: node.namespaceURI,
    name: node.localName,
    attrs: Array.from(node.attributes)
      .filter((a) => a.name !== 'xmlns' && !a.name.startsWith('xmlns:'))
      .map((a) => [a.namespaceURI, a.localName, a.value])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    text: Array.from(node.childNodes)
      .filter(
        (n) =>
          n.nodeType === 3 &&
          (Boolean(n.nodeValue?.trim()) ||
            ['t', 'delText', 'instrText'].includes(node.localName ?? '')),
      )
      .map((n) => (n.nodeValue ?? '').replace(/\r\n?/g, '\n'))
      .join(''),
    children: elements(node).map(canonical),
  });
  const records = all(doc, NS.w)
    .filter((n) => isRevisionMarkup(n) && members.includes(n.getAttributeNS(NS.w, 'id') ?? ''))
    .map(canonical);
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
};
const staleGroups = (archive: OpcArchive): boolean => {
  if (!archive.getPart(groupPart(archive))) return false;
  const doc = archive.readXml(DOCUMENT_PART);
  const active = new Set(
    all(doc, NS.w)
      .filter(isRevisionMarkup)
      .map((n) => n.getAttributeNS(NS.w, 'id')),
  );
  const metadata = archive.readXml(groupPart(archive));
  const recorded = all(metadata, GROUP_NS, 'group');
  const known = new Set([
    ...recorded.flatMap((n) => (n.getAttribute('ids') ?? '').split(' ')),
    ...(root(metadata).getAttribute('baselineIds') ?? '').split(' '),
  ]);
  if ([...active].some((id) => id && !known.has(id))) return true;
  return recorded.some((n) => {
    const ids = (n.getAttribute('ids') ?? '').split(' ').filter(Boolean);
    if (!ids.some((id) => active.has(id))) return false;
    return n.getAttribute('fingerprint') !== groupFingerprint(doc, ids);
  });
};
const recordNodes = (archive: OpcArchive): Map<string, Element> => {
  const result = new Map<string, Element>();
  const records = scanRevisions(archive).items;
  for (const part of new Set(records.map((n) => n.partUri))) {
    const doc = archive.readXml(part);
    const nodes = all(doc, NS.w).filter(isRevisionMarkup);
    const local = records.filter((n) => n.partUri === part);
    local.forEach((r, i) => {
      const n = nodes[i];
      if (n) result.set(r.id, n);
    });
  }
  return result;
};
export const previewDecision = (
  archive: OpcArchive,
  ids: string[] | undefined,
  every: boolean | undefined,
  decision?: 'accept' | 'reject',
): { ids: string[]; changedParts: string[]; blocked: string[]; requiredIds: string[] } => {
  const inventory = scanRevisions(archive);
  const nodes = recordNodes(archive);
  const selected = every ? inventory.items : inventory.items.filter((r) => ids?.includes(r.id));
  const groups = [...readGroups(archive), ...moveGroups(archive)];
  const blocked: string[] = [];
  if (!every && staleGroups(archive))
    blocked.push(
      'Review groups changed externally; select all revisions or settle them in Office before partial decisions',
    );
  const requiredIds = new Set<string>();
  if (!every && ids?.some((id) => !nodes.has(id))) blocked.push('Revision not found');
  for (const item of selected) {
    const n = nodes.get(item.id);
    if (!n || !supported(n)) blocked.push(`Unsupported revision structure: ${item.id}`);
    if (item.partUri !== DOCUMENT_PART || (n && !inWritableBodyStory(n)))
      blocked.push(`Read-only story: ${item.partUri}`);
    if (n) {
      const parent = n.parentNode as Element | null;
      const structural =
        parent?.localName === 'trPr' ||
        ['cellIns', 'cellDel', 'tblGridChange'].includes(n.localName ?? '') ||
        (parent?.localName === 'rPr' && (parent.parentNode as Element | null)?.localName === 'pPr');
      if (structural) {
        const owner = nearest(
          n,
          parent?.localName === 'trPr'
            ? ['tr']
            : n.localName === 'tblGridChange'
              ? ['tbl']
              : ['tc', 'p'],
        );
        if (owner) {
          for (const related of inventory.items) {
            const candidate = nodes.get(related.id);
            if (
              candidate &&
              all(owner, NS.w).includes(candidate) &&
              !selected.some((s) => s.id === related.id)
            )
              requiredIds.add(related.id);
          }
        }
      }
      let a = n.parentNode;
      while (a?.nodeType === 1) {
        if (isRevisionMarkup(a as Element)) blocked.push(`Nested revision: ${item.id}`);
        a = a.parentNode;
      }
      const owner = nearest(n, ['p', 'tr', 'tbl']);
      if (
        owner &&
        all(owner, NS.w).some((c) =>
          ['commentRangeStart', 'commentRangeEnd', 'commentReference'].includes(c.localName ?? ''),
        )
      )
        blocked.push(`Revision intersects a comment: ${item.id}`);
    }
    for (const other of inventory.items)
      if (
        other.partUri === item.partUri &&
        (other.nativeId === item.nativeId ||
          groups.some(
            (g) => g.includes(item.nativeId ?? '') && g.includes(other.nativeId ?? ''),
          )) &&
        !selected.some((s) => s.id === other.id)
      )
        requiredIds.add(other.id);
  }
  const sectionOf = (n: Element): number => {
    let block: Element = n;
    while (block.parentNode?.nodeType === 1 && (block.parentNode as Element).localName !== 'body')
      block = block.parentNode as Element;
    const parent = block.parentNode;
    if (!parent) return -1;
    let section = 0;
    for (const child of elements(parent)) {
      if (child === block) return section;
      if (all(child, NS.w, 'sectPr').length) section++;
    }
    return section;
  };
  for (const group of groups) {
    const moves = selected.filter(
      (r) => ['moveFrom', 'moveTo'].includes(r.type) && group.includes(r.nativeId ?? ''),
    );
    const sections = new Set<number>();
    for (const r of moves) {
      const n = nodes.get(r.id);
      if (n) {
        sections.add(sectionOf(n));
        if (nearest(n, ['tc'])) blocked.push('Moves inside table cells are read-only');
      }
    }
    if (sections.size > 1) blocked.push('Cross-section moves are read-only');
  }
  if (requiredIds.size) blocked.push('Selection omits dependent revisions');
  if (inventory.diagnostics.length)
    blocked.push('Resolve malformed revision identifiers or ranges before review decisions');
  if (!blocked.length && decision) {
    try {
      applyNodes(
        selected.map((r) => nodes.get(r.id)).filter((n): n is Element => Boolean(n)),
        decision === 'accept',
      );
    } catch (cause) {
      blocked.push(cause instanceof Error ? cause.message : 'Decision projection failed');
    }
  }
  return {
    ids: selected.map((r) => r.id),
    changedParts: [...new Set(selected.map((r) => r.partUri))],
    blocked: [...new Set(blocked)],
    requiredIds: [...requiredIds],
  };
};
const nearest = (node: Element, names: string[]): Element | undefined => {
  let p = node.parentNode;
  while (p?.nodeType === 1) {
    if (names.includes((p as Element).localName ?? '')) return p as Element;
    p = p.parentNode;
  }
  return undefined;
};
const convertDeleted = (node: Element): void => {
  for (const t of all(node, NS.w, 'delText')) {
    const n = make(node.ownerDocument, NS.w, 'w:t');
    for (let i = 0; i < t.attributes.length; i++) {
      const a = t.attributes.item(i);
      if (a) n.setAttribute(a.name, a.value);
    }
    n.textContent = t.textContent;
    t.parentNode?.replaceChild(n, t);
  }
};
const mergeNext = (p: Element): void => {
  let next = p.nextSibling;
  while (next && next.nodeType !== 1) next = next.nextSibling;
  if (!next || (next as Element).localName !== 'p')
    throw new Error('Paragraph mark has no adjacent paragraph');
  for (const child of [...elements(next)]) if (child.localName !== 'pPr') p.appendChild(child);
  remove(next);
};
const applyNode = (n: Element, accept: boolean): void => {
  if (!n.parentNode) return;
  const name = n.localName ?? '';
  const parent = n.parentNode as Element;
  if (propsNames.has(name)) {
    if (!accept) {
      const old = elements(n).find(
        (c) => c.localName === parent.localName && c.namespaceURI === NS.w,
      );
      if (!old) throw new Error('Property revision has no prior property set');
      const restored = old.cloneNode(true) as Element;
      if (name === 'pPrChange')
        for (const child of elements(parent))
          if (child.namespaceURI === NS.w && ['rPr', 'sectPr'].includes(child.localName ?? ''))
            restored.appendChild(child);
      parent.parentNode?.replaceChild(restored, parent);
    } else remove(n);
    return;
  }
  if (/^(moveFrom|moveTo)Range(Start|End)$/.test(name)) {
    remove(n);
    return;
  }
  if (name === 'cellMerge') {
    const attr = accept ? 'vMerge' : 'vMergeOrig';
    const value = n.getAttributeNS(NS.w, attr);
    for (const vm of elements(parent).filter((c) => c.localName === 'vMerge')) remove(vm);
    if (value) {
      const vm = make(n.ownerDocument, NS.w, 'w:vMerge');
      vm.setAttributeNS(NS.w, 'w:val', value === 'rest' ? 'restart' : 'continue');
      parent.insertBefore(vm, n);
    }
    remove(n);
    return;
  }
  if (name === 'cellIns' || name === 'cellDel') {
    const keep = accept === (name === 'cellIns');
    if (keep) remove(n);
    else if (parent.parentNode) remove(parent.parentNode);
    return;
  }
  const insertion = name === 'ins' || name === 'moveTo';
  const keep = accept === insertion;
  if (parent.localName === 'trPr') {
    const row = parent.parentNode;
    if (!keep && row) remove(row);
    else remove(n);
    return;
  }
  if (parent.localName === 'rPr' && (parent.parentNode as Element | null)?.localName === 'pPr') {
    const p = nearest(n, ['p']);
    if (!p) throw new Error('Invalid paragraph mark');
    if (!keep) {
      remove(n);
      mergeNext(p);
    } else remove(n);
    return;
  }
  if (keep) {
    if (!insertion) convertDeleted(n);
    unwrap(n);
  } else remove(n);
};
const applyNodes = (selected: Element[], accept: boolean): void => {
  // Whole inserted/deleted paragraphs carry revisions on both text and paragraph marks.
  const removed = new Set<Element>();
  for (const n of selected) {
    if (
      ['ins', 'del'].includes(n.localName ?? '') &&
      n.parentNode &&
      (n.parentNode as Element).localName === 'rPr' &&
      (n.parentNode.parentNode as Element | null)?.localName === 'pPr'
    ) {
      const p = nearest(n, ['p']);
      const insertion = n.localName === 'ins';
      if (p && accept !== insertion) {
        const content = elements(p).filter((c) => c.localName !== 'pPr');
        if (
          content.length &&
          content.every((c) =>
            [insertion ? 'ins' : 'del', insertion ? 'moveTo' : 'moveFrom'].includes(
              c.localName ?? '',
            ),
          )
        ) {
          removed.add(p);
          remove(p);
        }
      }
    }
  }
  for (const n of [...selected].reverse())
    if (![...removed].some((p) => p === nearest(n, ['p']))) applyNode(n, accept);
};
export const decideRevisions = (
  archive: OpcArchive,
  ids: string[] | undefined,
  every: boolean | undefined,
  accept: boolean,
): Record<string, unknown> => {
  const preview = previewDecision(archive, ids, every, accept ? 'accept' : 'reject');
  if (preview.blocked.length) throw new Error(preview.blocked.join('; '));
  const records = scanRevisions(archive).items;
  const chosen = new Set(preview.ids);
  for (const part of preview.changedParts) {
    const doc = archive.readXml(part);
    const local = records.filter((r) => r.partUri === part);
    const nodes = all(doc, NS.w).filter(isRevisionMarkup);
    const selected = nodes.filter((_, i) => chosen.has(local[i]?.id ?? ''));
    applyNodes(selected, accept);
    archive.writeXml(part, doc);
  }
  return {
    changed: preview.ids.length > 0,
    ids: preview.ids,
    changedParts: preview.changedParts,
    changedTargets: preview.ids,
  };
};
export const reviewView = (
  archive: OpcArchive,
  view: 'original' | 'final' | 'markup',
  partUri?: string,
): Record<string, unknown> => {
  const scanned = scanRevisions(archive);
  const stories: Record<string, unknown>[] = [];
  let complete = true;
  const nodes = recordNodes(archive);
  for (const [part, data] of archive.parts) {
    if (
      !part.startsWith('/word/') ||
      part.endsWith('.rels') ||
      !data.mediaType.includes('xml') ||
      (partUri && part !== partUri)
    )
      continue;
    const doc = archive.readXml(part);
    if (!all(doc, NS.w, 'p').length) continue;
    const revisions = all(doc, NS.w).filter(isRevisionMarkup);
    const opaque = revisions.filter((n) => !supported(n));
    if (opaque.length) complete = false;
    if (view !== 'markup') {
      try {
        applyNodes(revisions.filter(supported), view === 'final');
      } catch {
        complete = false;
      }
    }
    stories.push({
      partUri: part,
      text: all(doc, NS.w, 'p')
        .filter((p) => !nearest(p, ['p']))
        .map((p) =>
          all(p, NS.w)
            .filter((n) => n.localName === 't' || (view === 'markup' && n.localName === 'delText'))
            .map((n) => n.textContent ?? '')
            .join(''),
        )
        .join('\n'),
      ...(view === 'markup' ? { revisions: scanned.items.filter((n) => n.partUri === part) } : {}),
      opaque: opaque.map((n) => n.localName),
      xml: new XMLSerializer().serializeToString(doc),
    });
  }
  return {
    view,
    complete: complete && scanned.diagnostics.length === 0,
    stories,
    diagnostics: scanned.diagnostics,
    revisionCount: nodes.size,
  };
};
const ownerDocument = (n: Element): Document => {
  if (!n.ownerDocument) throw new Error('Missing owner document');
  return n.ownerDocument;
};
const metadata = (n: Element, id: string, author: ReviewAuthor, now: Date): void => {
  n.setAttributeNS(NS.w, 'w:id', id);
  n.setAttributeNS(NS.w, 'w:author', author.name);
  n.setAttributeNS(NS.w, 'w:date', now.toISOString());
};
const mark = (
  doc: Document,
  name: string,
  id: string,
  author: ReviewAuthor,
  now: Date,
): Element => {
  const n = make(doc, NS.w, `w:${name}`);
  const allocator = allocations.get(doc);
  const native = allocator ? String(allocator.next++) : id;
  if (allocator) {
    const members = allocator.groups.get(id) ?? [];
    members.push(native);
    allocator.groups.set(id, members);
  }
  metadata(n, native, author, now);
  return n;
};
const paragraphMark = (
  p: Element,
  name: string,
  id: string,
  author: ReviewAuthor,
  now: Date,
): void => {
  let props = elements(p).find((n) => n.localName === 'pPr');
  if (!props) {
    props = make(p.ownerDocument, NS.w, 'w:pPr');
    p.insertBefore(props, p.firstChild);
  }
  let rpr = elements(props).find((n) => n.localName === 'rPr');
  if (!rpr) {
    rpr = make(p.ownerDocument, NS.w, 'w:rPr');
    props.appendChild(rpr);
  }
  rpr.appendChild(mark(ownerDocument(p), name, id, author, now));
};
const wrapRuns = (p: Element, name: string, id: string, author: ReviewAuthor, now: Date): void => {
  const wrapper = mark(ownerDocument(p), name, id, author, now);
  for (const n of [...elements(p)]) if (n.localName !== 'pPr') wrapper.appendChild(n);
  if (name === 'del')
    for (const t of all(wrapper, NS.w, 't')) {
      const dt = make(p.ownerDocument, NS.w, 'w:delText');
      dt.setAttribute('xml:space', 'preserve');
      dt.textContent = t.textContent;
      t.parentNode?.replaceChild(dt, t);
    }
  p.appendChild(wrapper);
};
const proposeOne = (
  archive: OpcArchive,
  doc: Document,
  op: ProposalOperation,
  id: string,
  author: ReviewAuthor,
  now: Date,
): void => {
  const target = 'target' in op ? op.target : op.start.target;
  const p = op.op === 'replaceText' ? paragraphAt(doc, op.start.target) : undefined;
  if (op.op === 'replaceText' && p) {
    const q = paragraphAt(doc, op.end.target);
    assertPlain(p);
    assertPlain(q);
    if (p !== q) {
      if (p.parentNode !== q.parentNode)
        throw new Error('Cross-paragraph ranges must share a text region');
      const siblings = elements(p.parentNode ?? doc);
      const a = siblings.indexOf(p),
        b = siblings.indexOf(q);
      if (
        a < 0 ||
        b < a ||
        siblings.slice(a, b + 1).some((n) => n.localName !== 'p' || all(n, NS.w, 'sectPr').length)
      )
        throw new Error('Range crosses a structural boundary');
      const paragraphs = siblings.slice(a, b + 1);
      for (const n of paragraphs) assertPlain(n);
      let insertionPoint: Element | null = null;
      for (let i = 0; i < paragraphs.length; i++) {
        const current = paragraphs[i];
        if (!current) continue;
        const from = i === 0 ? op.start.offset : 0,
          to = i === paragraphs.length - 1 ? op.end.offset : plainText(current).length;
        const end = boundary(current, to),
          begin = boundary(current, from);
        const del = mark(doc, 'del', id, author, now);
        let cursor = begin;
        while (cursor && cursor !== end) {
          const next = cursor.nextSibling;
          del.appendChild(cursor);
          cursor = next?.nodeType === 1 ? (next as Element) : null;
        }
        if (del.childNodes.length) {
          for (const t of all(del, NS.w, 't')) {
            const dt = make(doc, NS.w, 'w:delText');
            dt.setAttribute('xml:space', 'preserve');
            dt.textContent = t.textContent;
            t.parentNode?.replaceChild(dt, t);
          }
          current.insertBefore(del, end);
        }
        if (i === 0) insertionPoint = del.childNodes.length ? del : end;
        if (i < paragraphs.length - 1) paragraphMark(current, 'del', id, author, now);
      }
      if (op.text) {
        const ins = mark(doc, 'ins', id, author, now);
        ins.appendChild(textRun(doc, op.text));
        p.insertBefore(ins, insertionPoint);
      }
      return;
    }
    if (op.start.offset > op.end.offset) throw new Error('Reversed range');
    const end = boundary(p, op.end.offset);
    const start = boundary(p, op.start.offset);
    const del = mark(doc, 'del', id, author, now);
    let cur = start;
    while (cur && cur !== end) {
      const next = cur.nextSibling;
      del.appendChild(cur);
      cur = next?.nodeType === 1 ? (next as Element) : null;
    }
    if (del.childNodes.length) {
      for (const t of all(del, NS.w, 't')) {
        const dt = make(doc, NS.w, 'w:delText');
        dt.setAttribute('xml:space', 'preserve');
        dt.textContent = t.textContent;
        t.parentNode?.replaceChild(dt, t);
      }
      p.insertBefore(del, end);
    }
    if (op.text) {
      const ins = mark(doc, 'ins', id, author, now);
      ins.appendChild(textRun(doc, op.text, false, start ?? undefined));
      p.insertBefore(ins, end);
    }
    return;
  }
  const hit = hitsFrom(doc, undefined).find(
    (h) => h.path === target || (h.paraId && `para:${h.paraId}` === target),
  );
  if (!hit) throw new Error(`Target not found: ${target}`);
  const node = hit.element;
  const protectedReason = protectionReason(node);
  if (protectedReason) throw new Error(protectedReason);
  if (op.op === 'setProperties') {
    const before = node.cloneNode(true) as Element;
    const result = applyProperties(archive, node, hit.kind, op.properties);
    if (!result.ok) throw new Error(result.error.message);
    const pairs: { owner: Element; oldOwner: Element | undefined; kind: 'pPr' | 'rPr' }[] = [];
    if (hit.kind === 'paragraph') {
      if (Object.keys(op.properties).some((k) => k.startsWith('paragraph.')))
        pairs.push({ owner: node, oldOwner: before, kind: 'pPr' });
      if (Object.keys(op.properties).some((k) => !k.startsWith('paragraph.'))) {
        const pp = elements(node).find((n) => n.localName === 'pPr');
        if (pp)
          pairs.push({
            owner: pp,
            oldOwner: elements(before).find((n) => n.localName === 'pPr'),
            kind: 'rPr',
          });
        const oldRuns = all(before, NS.w, 'r');
        all(node, NS.w, 'r').forEach((owner, i) =>
          pairs.push({ owner, oldOwner: oldRuns[i], kind: 'rPr' }),
        );
      }
    } else pairs.push({ owner: node, oldOwner: before, kind: 'rPr' });
    const snapshot = (n: Element | undefined, kind: string): Element => {
      const copy = (n?.cloneNode(true) as Element | undefined) ?? make(doc, NS.w, 'w:' + kind);
      if (kind === 'pPr')
        for (const child of elements(copy))
          if (child.namespaceURI === NS.w && ['rPr', 'sectPr'].includes(child.localName ?? ''))
            remove(child);
      return copy;
    };
    const serializer = new XMLSerializer();
    for (const { owner, oldOwner, kind } of pairs) {
      let current = elements(owner).find((n) => n.localName === kind);
      const old = oldOwner && elements(oldOwner).find((n) => n.localName === kind);
      if (!current && !old) continue;
      if (
        serializer.serializeToString(snapshot(current, kind)) ===
        serializer.serializeToString(snapshot(old, kind))
      )
        continue;
      if (!current) {
        current = make(doc, NS.w, 'w:' + kind);
        owner.insertBefore(current, owner.firstChild);
      }
      const change = mark(doc, kind + 'Change', id, author, now);
      change.appendChild(snapshot(old, kind));
      current.appendChild(change);
    }
    return;
  }
  if (['insertParagraph', 'deleteParagraph', 'splitParagraph', 'mergeParagraph'].includes(op.op)) {
    if (hit.kind !== 'paragraph') throw new Error('Paragraph operation requires a paragraph');
    if (all(node, NS.w, 'sectPr').length)
      throw new Error('Paragraph structure changes cannot alter section boundaries');
    assertPlain(node);
    if (op.op === 'insertParagraph') {
      const fresh = make(doc, NS.w, 'w:p');
      fresh.appendChild(textRun(doc, op.text));
      wrapRuns(fresh, 'ins', id, author, now);
      paragraphMark(fresh, 'ins', id, author, now);
      node.parentNode?.insertBefore(fresh, node.nextSibling);
    }
    if (op.op === 'deleteParagraph') {
      wrapRuns(node, 'del', id, author, now);
      paragraphMark(node, 'del', id, author, now);
    }
    if (op.op === 'splitParagraph') {
      const split = boundary(node, op.offset);
      const fresh = make(doc, NS.w, 'w:p');
      const props = elements(node).find((n) => n.localName === 'pPr');
      if (props) fresh.appendChild(props.cloneNode(true));
      let c = split;
      while (c) {
        const next = c.nextSibling;
        fresh.appendChild(c);
        c = next?.nodeType === 1 ? (next as Element) : null;
      }
      node.parentNode?.insertBefore(fresh, node.nextSibling);
      paragraphMark(node, 'ins', id, author, now);
    }
    if (op.op === 'mergeParagraph') {
      let next = node.nextSibling;
      while (next && next.nodeType !== 1) next = next.nextSibling;
      if (!next || (next as Element).localName !== 'p') throw new Error('No next paragraph');
      assertPlain(next as Element);
      paragraphMark(node, 'del', id, author, now);
    }
    return;
  }
  if (op.op === 'moveParagraphs') {
    const end = paragraphAt(doc, op.endTarget),
      after = paragraphAt(doc, op.after);
    if (
      node.parentNode !== end.parentNode ||
      node.parentNode !== after.parentNode ||
      (node.parentNode as Element | null)?.localName !== 'body'
    )
      throw new Error('Moves require paragraphs in the same body');
    const siblings = elements(node.parentNode ?? doc);
    const startIndex = siblings.indexOf(node),
      endIndex = siblings.indexOf(end);
    if (startIndex > endIndex) throw new Error('Reversed move range');
    const moving = siblings.slice(startIndex, endIndex + 1);
    if (moving.includes(after) || moving.some((n) => n.localName !== 'p'))
      throw new Error('Move requires continuous paragraphs and an outside destination');
    for (const p of moving) {
      assertPlain(p);
      if (all(p, NS.w, 'sectPr').length) throw new Error('Moves cannot cross section boundaries');
    }
    const name = 'deckuse_move_' + id;
    const sourceStart = mark(doc, 'moveFromRangeStart', id, author, now);
    sourceStart.setAttributeNS(NS.w, 'w:name', name);
    const sourceEnd = make(doc, NS.w, 'w:moveFromRangeEnd');
    sourceEnd.setAttributeNS(NS.w, 'w:id', sourceStart.getAttributeNS(NS.w, 'id') ?? '');
    node.parentNode?.insertBefore(sourceStart, node);
    end.parentNode?.insertBefore(sourceEnd, end.nextSibling);
    const targetStart = mark(doc, 'moveToRangeStart', id, author, now);
    targetStart.setAttributeNS(NS.w, 'w:name', name);
    after.parentNode?.insertBefore(targetStart, after.nextSibling);
    let anchor: Element = targetStart;
    for (const p of moving) {
      const clone = p.cloneNode(true) as Element;
      clone.removeAttributeNS(NS.w14, 'paraId');
      wrapRuns(p, 'moveFrom', id, author, now);
      paragraphMark(p, 'del', id, author, now);
      wrapRuns(clone, 'moveTo', id, author, now);
      paragraphMark(clone, 'ins', id, author, now);
      anchor.parentNode?.insertBefore(clone, anchor.nextSibling);
      anchor = clone;
    }
    const targetEnd = make(doc, NS.w, 'w:moveToRangeEnd');
    targetEnd.setAttributeNS(NS.w, 'w:id', targetStart.getAttributeNS(NS.w, 'id') ?? '');
    anchor.parentNode?.insertBefore(targetEnd, anchor.nextSibling);
    return;
  }
  if (
    ['insertRow', 'deleteRow', 'insertColumn', 'deleteColumn', 'mergeCells', 'splitCell'].includes(
      op.op,
    )
  ) {
    if (hit.kind !== 'table') throw new Error('Structural table operation requires a table');
    if (all(node, NS.w, 'tbl').length)
      throw new Error('Nested tables cannot be structurally revised');
    if (all(node, NS.w).some((n) => ['bookmarkStart', 'bookmarkEnd'].includes(n.localName ?? '')))
      throw new Error('Structural table revisions cannot invalidate bookmark ranges');
    const rows = elements(node).filter((n) => n.localName === 'tr');
    const cells = (r: Element) => elements(r).filter((n) => n.localName === 'tc');
    if (!rows.length) throw new Error('Table has no rows');
    const firstRow = rows[0];
    if (!firstRow) throw new Error('Table has no rows');
    const width = cells(firstRow).length;
    if (
      rows.some((r) => cells(r).length !== width) ||
      all(node, NS.w).some((n) =>
        ['gridSpan', 'hMerge', ...(op.op === 'splitCell' ? [] : ['vMerge'])].includes(
          n.localName ?? '',
        ),
      )
    )
      throw new Error('Structural revisions require a regular unmerged table');
    const props = (n: Element, kind: string) => {
      let p = elements(n).find((c) => c.localName === kind);
      if (!p) {
        p = make(doc, NS.w, 'w:' + kind);
        n.insertBefore(p, n.firstChild);
      }
      return p;
    };
    if (op.op === 'insertRow' || op.op === 'deleteRow') {
      if (op.index > rows.length || (op.op === 'deleteRow' && op.index === rows.length))
        throw new Error('Row index out of range');
      if (op.op === 'deleteRow' && rows.length === 1) throw new Error('Cannot delete the only row');
      const row =
        op.op === 'deleteRow'
          ? rows[op.index]
          : (rows[Math.min(op.index, rows.length - 1)]?.cloneNode(true) as Element | undefined);
      if (!row) throw new Error('Row missing');
      if (op.op === 'insertRow') {
        for (const p of all(row, NS.w, 'p')) {
          p.removeAttributeNS(NS.w14, 'paraId');
          for (const c of [...elements(p)]) if (c.localName !== 'pPr') remove(c);
        }
        node.insertBefore(row, rows[op.index] ?? null);
      }
      props(row, 'trPr').appendChild(
        mark(doc, op.op === 'insertRow' ? 'ins' : 'del', id, author, now),
      );
      return;
    }
    if (op.op === 'insertColumn' || op.op === 'deleteColumn') {
      if (op.index > width || (op.op === 'deleteColumn' && op.index === width))
        throw new Error('Column index out of range');
      if (op.op === 'deleteColumn' && width === 1) throw new Error('Cannot delete only column');
      const grid = elements(node).find((n) => n.localName === 'tblGrid');
      if (!grid) throw new Error('Table grid missing');
      const old = grid.cloneNode(true);
      const cols = elements(grid).filter((n) => n.localName === 'gridCol');
      if (op.op === 'insertColumn') {
        const col = cols[Math.min(op.index, cols.length - 1)]?.cloneNode(true);
        if (!col) throw new Error('Grid column missing');
        grid.insertBefore(col, cols[op.index] ?? null);
      } else {
        const col = cols[op.index];
        if (!col) throw new Error('Grid column missing');
        remove(col);
      }
      const change = mark(doc, 'tblGridChange', id, author, now);
      change.appendChild(old);
      grid.appendChild(change);
      for (const row of rows) {
        const list = cells(row);
        const cell =
          op.op === 'deleteColumn'
            ? list[op.index]
            : (list[Math.min(op.index, width - 1)]?.cloneNode(true) as Element | undefined);
        if (!cell) throw new Error('Cell missing');
        if (op.op === 'insertColumn') {
          for (const p of all(cell, NS.w, 'p')) {
            p.removeAttributeNS(NS.w14, 'paraId');
            for (const c of [...elements(p)]) if (c.localName !== 'pPr') remove(c);
          }
          row.insertBefore(cell, list[op.index] ?? null);
        }
        props(cell, 'tcPr').appendChild(
          mark(doc, op.op === 'insertColumn' ? 'cellIns' : 'cellDel', id, author, now),
        );
      }
      return;
    }
    if (op.op === 'mergeCells' || op.op === 'splitCell') {
      if (op.column >= width || op.row + op.count > rows.length)
        throw new Error('Vertical merge range exceeds table');
      const topRow = rows[op.row];
      const topCell = topRow && cells(topRow)[op.column];
      if (!topCell) throw new Error('Merge origin missing');
      if (op.op === 'splitCell') {
        const following = rows[op.row + op.count];
        const continuation = following && cells(following)[op.column];
        const vm = continuation && all(continuation, NS.w, 'vMerge')[0];
        if (vm && vm.getAttributeNS(NS.w, 'val') !== 'restart')
          throw new Error('Split requires the complete vertical merge group');
      }
      for (let i = 0; i < op.count; i++) {
        const row = rows[op.row + i];
        const cell = row && cells(row)[op.column];
        if (!cell) throw new Error('Cell missing');
        for (const p of elements(cell).filter((n) => n.localName === 'p')) assertPlain(p);
      }
      for (let i = 0; i < op.count; i++) {
        const row = rows[op.row + i];
        if (!row) throw new Error('Row missing');
        const cell = cells(row)[op.column];
        if (!cell) throw new Error('Cell missing');
        const cp = props(cell, 'tcPr');
        const vm = elements(cp).find((n) => n.localName === 'vMerge');
        if (
          op.op === 'splitCell' &&
          (!vm ||
            (i === 0
              ? vm.getAttributeNS(NS.w, 'val') !== 'restart'
              : vm.getAttributeNS(NS.w, 'val') === 'restart'))
        )
          throw new Error('Split requires the complete vertical merge group');
        const revision = mark(doc, 'cellMerge', id, author, now);
        if (vm)
          revision.setAttributeNS(
            NS.w,
            'w:vMergeOrig',
            vm.getAttributeNS(NS.w, 'val') === 'restart' ? 'rest' : 'cont',
          );
        if (op.op === 'mergeCells')
          revision.setAttributeNS(NS.w, 'w:vMerge', i === 0 ? 'rest' : 'cont');
        if (vm) remove(vm);
        if (op.op === 'mergeCells') {
          const merged = make(doc, NS.w, 'w:vMerge');
          merged.setAttributeNS(NS.w, 'w:val', i === 0 ? 'restart' : 'continue');
          cp.appendChild(merged);
        }
        cp.appendChild(revision);
        if (op.op === 'mergeCells' && i > 0) {
          for (const paragraph of elements(cell).filter((n) => n.localName === 'p')) {
            const copy = paragraph.cloneNode(true) as Element;
            copy.removeAttributeNS(NS.w14, 'paraId');
            wrapRuns(copy, 'ins', id, author, now);
            paragraphMark(copy, 'ins', id, author, now);
            topCell.appendChild(copy);
            wrapRuns(paragraph, 'del', id, author, now);
          }
        }
      }
      return;
    }
  }
  throw new Error(`Unsupported proposal operation: ${op.op}`);
};
export const mutateRevisions = (
  archive: OpcArchive,
  command: ReviewWrite,
  now: Date,
): Record<string, unknown> => {
  if (command.type === 'acceptRevisions' || command.type === 'rejectRevisions')
    return decideRevisions(archive, command.ids, command.all, command.type === 'acceptRevisions');
  if (command.type !== 'proposeChanges') throw new Error('Not a revision command');
  if (
    archive.getPart(groupPart(archive)) &&
    root(archive.readXml(groupPart(archive))).namespaceURI !== GROUP_NS
  )
    throw new Error('Review metadata part conflicts with existing package data');
  const doc = archive.readXml(DOCUMENT_PART);
  let id =
    Math.max(
      0,
      ...all(doc, NS.w)
        .map((n) => Number(n.getAttributeNS(NS.w, 'id') ?? 0))
        .filter(Number.isFinite),
    ) + 1;
  id = Math.max(
    id,
    ...readGroups(archive)
      .flat()
      .map((n) => Number(n) + 1)
      .filter(Number.isFinite),
  );
  const baselineIds = all(doc, NS.w)
    .filter(isRevisionMarkup)
    .map((n) => n.getAttributeNS(NS.w, 'id') ?? '')
    .filter(Boolean)
    .join(' ');
  const allocator = { next: id, groups: new Map<string, string[]>() };
  allocations.set(doc, allocator);
  for (const op of command.operations)
    proposeOne(archive, doc, op, String(id++), command.author, now);
  archive.writeXml(DOCUMENT_PART, doc);
  const formattedDocument = archive.readXml(DOCUMENT_PART);
  const groups = archive.getPart(groupPart(archive))
    ? archive.readXml(groupPart(archive))
    : parseXml(`<du:groups xmlns:du="${GROUP_NS}"/>`);
  if (!archive.getPart(groupPart(archive))) root(groups).setAttribute('baselineIds', baselineIds);
  for (const members of allocator.groups.values())
    root(groups).appendChild(
      make(groups, GROUP_NS, 'du:group', {
        ids: members.join(' '),
        fingerprint: groupFingerprint(formattedDocument, members),
      }),
    );
  archive.writeXml(groupPart(archive), groups, 'application/xml');
  rel(
    archive,
    DOCUMENT_PART,
    groupPart(archive),
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml',
  );
  return {
    changed: true,
    changedParts: [DOCUMENT_PART],
    changedTargets: command.operations.map((op) => ('target' in op ? op.target : op.start.target)),
  };
};
