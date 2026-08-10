import type { Document, Element, Node } from '@xmldom/xmldom';
export const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
} as const;
export const REL = {
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  notes: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
  chart: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  layout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  package: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package',
} as const;
export const root = (doc: Document): Element => {
  if (!doc.documentElement) throw new Error('XML has no document element');
  return doc.documentElement;
};
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
export const first = (node: Node, localName: string): Element | undefined =>
  descendants(node, localName)[0];
export const attr = (node: Element | undefined, name: string): string | undefined =>
  node?.getAttribute(name) ?? undefined;
export const textOf = (node: Node): string =>
  descendants(node, 't')
    .map((item) => item.textContent ?? '')
    .join('');
const textContainer = (text: Element, boundary: Node): Element | undefined => {
  let current: Node | null = text.parentNode;
  while (current && current !== boundary) {
    if (
      current.nodeType === 1 &&
      (current as Element).namespaceURI === NS.a &&
      ['r', 'fld'].includes((current as Element).localName ?? '')
    )
      return current as Element;
    current = current.parentNode;
  }
  return undefined;
};
export const setNodeText = (node: Node, text: string): void => {
  const values = descendants(node, 't');
  if (values[0]) {
    values[0].textContent = text;
    const staleContainers = new Set<Element>();
    for (const value of values.slice(1)) {
      const container = textContainer(value, node);
      if (container) staleContainers.add(container);
      else value.parentNode?.removeChild(value);
    }
    for (const container of staleContainers) container.parentNode?.removeChild(container);
    return;
  }
  const doc = node.ownerDocument;
  if (!doc) throw new Error('Node has no document');
  const paragraph = doc.createElementNS(NS.a, 'a:p'),
    run = doc.createElementNS(NS.a, 'a:r'),
    value = doc.createElementNS(NS.a, 'a:t');
  value.appendChild(doc.createTextNode(text));
  run.appendChild(value);
  paragraph.appendChild(run);
  node.appendChild(paragraph);
};
export const cNvPr = (node: Element): Element | undefined => first(node, 'cNvPr');
export const nextShapeId = (doc: Document): number =>
  Math.max(0, ...descendants(doc, 'cNvPr').map((item) => Number(attr(item, 'id') ?? 0))) + 1;
export const allocateShapeIds = (doc: Document, node: Element): void => {
  let id = nextShapeId(doc);
  const own = cNvPr(node);
  if (own) own.setAttribute('id', String(id++));
  for (const property of descendants(node, 'cNvPr')) property.setAttribute('id', String(id++));
};
