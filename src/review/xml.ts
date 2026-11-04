import type { Document, Element, Node } from '@xmldom/xmldom';
import { posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { OpcArchive } from '../opc/index.js';
export const elements = (node: Node): Element[] =>
  Array.from(node.childNodes).filter((n): n is Element => n.nodeType === 1);
export const all = (node: Node, ns?: string, name?: string): Element[] =>
  elements(node).flatMap((n) => [
    ...((!ns || n.namespaceURI === ns) && (!name || n.localName === name) ? [n] : []),
    ...all(n, ns, name),
  ]);
export const make = (
  doc: Document | null,
  ns: string,
  name: string,
  attrs: Record<string, string> = {},
): Element => {
  if (!doc) throw new Error('Missing owner document');
  const n = doc.createElementNS(ns, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
export const guid = (): string => '{' + randomUUID().toUpperCase() + '}';
export const rel = (archive: OpcArchive, source: string, target: string, type: string): void => {
  const rels = [...archive.getRelationships(source)];
  if (rels.some((r) => r.type === type && r.resolvedTarget === target)) return;
  let i = 1;
  while (rels.some((r) => r.id === `rId${String(i)}`)) i++;
  rels.push({
    id: `rId${String(i)}`,
    type,
    target: posix.relative(posix.dirname(source), target),
    resolvedTarget: target,
    external: false,
  });
  archive.setRelationships(source, rels);
};
export const checkedOffset = (text: string, offset: number): void => {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > text.length ||
    (offset > 0 &&
      offset < text.length &&
      /[\uD800-\uDBFF]/.test(text[offset - 1] ?? '') &&
      /[\uDC00-\uDFFF]/.test(text[offset] ?? ''))
  )
    throw new Error('Invalid UTF-16 text boundary');
};
export const remove = (n: Node): void => {
  n.parentNode?.removeChild(n);
};
export const unwrap = (n: Node): void => {
  const p = n.parentNode;
  if (!p) return;
  while (n.firstChild) p.insertBefore(n.firstChild, n);
  p.removeChild(n);
};

export const root = (doc: Document): Element => {
  if (!doc.documentElement) throw new Error('XML root missing');
  return doc.documentElement;
};

export const relatedPart = (
  archive: OpcArchive,
  source: string,
  type: string,
  fallback: string,
): string =>
  archive.getRelationships(source).find((r) => r.type === type && !r.external)?.resolvedTarget ??
  fallback;
