import { XMLSerializer } from '@xmldom/xmldom';
import { supportedRevision, inWritableBodyStory } from './revision-support.js';
import { createHash } from 'node:crypto';
import type { Element, Node } from '@xmldom/xmldom';
import type { Diagnostic } from '../core/index.js';
import type { OpcArchive } from '../opc/index.js';
import { NS, descendants, children } from './xml.js';

/** Native revision records are distinct from workspace commit revisions. */
export interface TrackedRevision {
  id: string;
  nativeId?: string | undefined;
  partUri: string;
  path: string;
  type: string;
  author?: string | undefined;
  createdAt?: string | undefined;
  text: string;
  capabilities: { create: boolean; accept: boolean; reject: boolean };
  nativeXml: string;
  location: { parentKind: string; xmlPath: string; writable: boolean };
  previousProperties?: string | undefined;
  currentProperties?: string | undefined;
  opaque: boolean;
}

export const REVISION_NAMES = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'rPrChange',
  'pPrChange',
  'sectPrChange',
  'tblPrChange',
  'tblPrExChange',
  'trPrChange',
  'tcPrChange',
  'tblGridChange',
  'cellIns',
  'cellDel',
  'cellMerge',
  'numberingChange',
  'customXmlInsRangeStart',
  'customXmlInsRangeEnd',
  'customXmlDelRangeStart',
  'customXmlDelRangeEnd',
  'customXmlMoveFromRangeStart',
  'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeStart',
  'customXmlMoveToRangeEnd',
]);

export const isRevisionMarkup = (node: Element): boolean =>
  node.namespaceURI === NS.w &&
  (REVISION_NAMES.has(node.localName ?? '') ||
    (/(?:Change|RangeStart|RangeEnd)$/.test(node.localName ?? '') &&
      ![
        'commentRangeStart',
        'commentRangeEnd',
        'bookmarkStart',
        'bookmarkEnd',
        'permStart',
        'permEnd',
      ].includes(node.localName ?? '')));

const xmlPath = (node: Element): string => {
  const parts: string[] = [];
  let current: Element | null = node;
  while (current) {
    const parent: Node | null = current.parentNode;
    const name = current.localName,
      ns = current.namespaceURI;
    const siblings = parent
      ? Array.from(parent.childNodes).filter(
          (c): c is Element =>
            c.nodeType === 1 &&
            (c as Element).localName === name &&
            (c as Element).namespaceURI === ns,
        )
      : [current];
    parts.unshift(`${name ?? ''}[${String(siblings.indexOf(current) + 1)}]`);
    current = parent?.nodeType === 1 ? (parent as Element) : null;
  }
  return '/' + parts.join('/');
};

const propertySnapshot = (
  node: Element,
): { previousProperties?: string; currentProperties?: string } => {
  if (!(node.localName ?? '').endsWith('Change') || !node.parentNode) return {};
  const current = node.parentNode.cloneNode(true);
  for (const child of children(current))
    if (child.localName === node.localName && child.namespaceURI === node.namespaceURI)
      current.removeChild(child);
  const before = children(node)[0];
  return {
    currentProperties: new XMLSerializer().serializeToString(current),
    ...(before ? { previousProperties: new XMLSerializer().serializeToString(before) } : {}),
  };
};

export const scanRevisions = (
  archive: OpcArchive,
): {
  items: TrackedRevision[];
  diagnostics: Diagnostic[];
  counts: Record<string, number>;
} => {
  const items: TrackedRevision[] = [];
  const diagnostics: Diagnostic[] = [];
  const counts: Record<string, number> = {};
  for (const [partUri, part] of archive.parts) {
    if (
      !partUri.startsWith('/word/') ||
      !part.mediaType.includes('xml') ||
      partUri.endsWith('.rels')
    )
      continue;
    const doc = archive.readXml(partUri);
    const seen = new Map<string, number>();
    const ranges = new Map<string, Element>();
    for (const node of descendants(doc)) {
      if (!isRevisionMarkup(node)) continue;
      const type = node.localName ?? '';
      const nativeId = node.getAttributeNS(NS.w, 'id') ?? undefined;
      const key = `${type}:${nativeId ?? ''}`;
      const occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);
      const path = `${partUri}#${key}:${String(occurrence)}`;
      const id = 'tracked:' + createHash('sha256').update(path).digest('hex').slice(0, 24);
      items.push({
        id,
        nativeId,
        partUri,
        path,
        type,
        author: node.getAttributeNS(NS.w, 'author') ?? undefined,
        createdAt: node.getAttributeNS(NS.w, 'date') ?? undefined,
        text: descendants(node)
          .filter(
            (child) =>
              child.namespaceURI === NS.w && ['t', 'delText'].includes(child.localName ?? ''),
          )
          .map((child) => child.textContent ?? '')
          .join(''),
        capabilities: {
          create:
            partUri === '/word/document.xml' &&
            inWritableBodyStory(node) &&
            supportedRevision(node) &&
            [
              'ins',
              'del',
              'moveFrom',
              'moveTo',
              'moveFromRangeStart',
              'moveFromRangeEnd',
              'moveToRangeStart',
              'moveToRangeEnd',
              'rPrChange',
              'pPrChange',
              'tblGridChange',
              'cellIns',
              'cellDel',
              'cellMerge',
            ].includes(type),
          accept:
            partUri === '/word/document.xml' &&
            supportedRevision(node) &&
            inWritableBodyStory(node),
          reject:
            partUri === '/word/document.xml' &&
            supportedRevision(node) &&
            inWritableBodyStory(node),
        },
        nativeXml: new XMLSerializer().serializeToString(node),
        location: {
          parentKind: (node.parentNode as Element | null)?.localName ?? '',
          xmlPath: xmlPath(node),
          writable: partUri === '/word/document.xml' && inWritableBodyStory(node),
        },
        ...propertySnapshot(node),
        opaque: !supportedRevision(node),
      });
      counts[type] = (counts[type] ?? 0) + 1;
      if (!nativeId || occurrence > 0)
        diagnostics.push({
          severity: 'warning',
          code: 'REVISION_ID_INVALID',
          message: `Missing or duplicate revision identifier at ${path}`,
          details: { partUri, type, nativeId },
        });
      if (/Range(Start|End)$/.test(type)) {
        const rangeKey = type.replace(/(Start|End)$/, '') + ':' + (nativeId ?? '');
        if (type.endsWith('Start')) ranges.set(rangeKey, node);
        else if (!ranges.delete(rangeKey))
          diagnostics.push({
            severity: 'warning',
            code: 'REVISION_RANGE_UNPAIRED',
            message: `Unpaired revision range at ${path}`,
            details: { partUri },
          });
      }
    }
    for (const key of ranges.keys())
      diagnostics.push({
        severity: 'warning',
        code: 'REVISION_RANGE_UNPAIRED',
        message: `Unclosed revision range ${key}`,
        details: { partUri },
      });
  }
  return { items, counts, diagnostics };
};
