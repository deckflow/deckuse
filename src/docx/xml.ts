import type { Document, Element, Node } from '@xmldom/xmldom';

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
} as const;

export const DOCUMENT_PART = '/word/document.xml';
export const STYLES_PART = '/word/styles.xml';

const PROTECTED = new Set([
  'sdt',
  'del',
  'ins',
  'moveFrom',
  'moveTo',
  'oMath',
  'oMathPara',
  'fldSimple',
  'fldChar',
  'instrText',
  'customXml',
  'commentRangeStart',
  'commentRangeEnd',
  'commentReference',
]);

export const children = (node: Node): Element[] =>
  Array.from(node.childNodes).filter((item): item is Element => item.nodeType === 1);

export const descendants = (node: Node, localName?: string): Element[] => {
  const result: Element[] = [];
  const visit = (current: Node): void => {
    for (const child of children(current)) {
      if (!localName || child.localName === localName) result.push(child);
      visit(child);
    }
  };
  visit(node);
  return result;
};

export const attr = (node: Element | undefined, name: string): string | undefined => {
  if (!node) return undefined;
  const value = node.getAttribute(name);
  return value === null || value === '' ? undefined : value;
};

export const wEl = (doc: Document, name: string): Element => doc.createElementNS(NS.w, `w:${name}`);

export const documentBody = (doc: Document): Element => {
  const root = doc.documentElement;
  if (!root) throw new Error('word/document.xml has no document element');
  const body =
    children(root).find((child) => child.localName === 'body') ?? descendants(root, 'body')[0];
  if (!body) throw new Error('word/document.xml has no w:body');
  return body;
};

export const paraIdOf = (paragraph: Element): string | undefined => {
  const raw =
    paragraph.getAttributeNS(NS.w14, 'paraId') ??
    paragraph.getAttribute('w14:paraId') ??
    paragraph.getAttribute('paraId');
  return raw ? raw.toUpperCase() : undefined;
};

export const ensureW14 = (doc: Document): void => {
  const root = doc.documentElement;
  if (!root) return;
  if (!root.getAttribute('xmlns:w14')) root.setAttribute('xmlns:w14', NS.w14);
  if (!root.getAttribute('xmlns:mc')) root.setAttribute('xmlns:mc', NS.mc);
  const ignorable = root.getAttribute('mc:Ignorable') ?? '';
  const tokens = ignorable.split(/\s+/).filter(Boolean);
  if (!tokens.includes('w14')) root.setAttribute('mc:Ignorable', [...tokens, 'w14'].join(' '));
};

export const protectionReason = (node: Element): string | undefined => {
  const hit = PROTECTED.has(node.localName ?? '')
    ? node
    : descendants(node).find((item) => PROTECTED.has(item.localName ?? ''));
  if (!hit) return undefined;
  return `Cannot rewrite ${hit.localName ?? 'markup'}; tracked changes, fields, comments, content controls, and equations are preserved`;
};

export const writeTextNode = (node: Element, value: string): void => {
  node.textContent = value;
  if (/^\s|\s$/.test(value) || value.includes('  ')) node.setAttribute('xml:space', 'preserve');
  else if (node.hasAttribute('xml:space')) node.removeAttribute('xml:space');
};
