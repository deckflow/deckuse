import type { Document, Element, Node } from '@xmldom/xmldom';
// Document is used by setNodeText helpers.
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
  video: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/video',
  audio: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio',
  media: 'http://schemas.microsoft.com/office/2007/relationships/media',
  layout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  slideMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  package: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
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
const paragraphContainer = (node: Node): Element | undefined => {
  if (node.nodeType === 1) {
    const el = node as Element;
    if (el.localName === 'txBody') return el;
    const txBody = first(el, 'txBody');
    if (txBody) return txBody;
  }
  return undefined;
};

const cloneRPr = (doc: Document, source: Element | undefined): Element | undefined => {
  if (!source) return undefined;
  return source.cloneNode(true) as Element;
};

/** Replace text under a node. Newlines become separate `a:p` paragraphs; first-run `rPr` is preserved. */
export const setNodeText = (node: Node, text: string): void => {
  const doc = node.ownerDocument;
  if (!doc) throw new Error('Node has no document');
  const lines = text.split('\n');
  const values = descendants(node, 't');
  let rPrTemplate: Element | undefined;
  if (values[0]) {
    const run = textContainer(values[0], node);
    if (run) rPrTemplate = cloneRPr(doc, children(run).find((c) => c.localName === 'rPr'));
  }

  const container = paragraphContainer(node);
  if (container) {
    for (const child of [...children(container)])
      if (child.localName === 'p') container.removeChild(child);
    for (const line of lines) {
      const paragraph = doc.createElementNS(NS.a, 'a:p');
      const run = doc.createElementNS(NS.a, 'a:r');
      if (rPrTemplate) run.appendChild(rPrTemplate.cloneNode(true));
      const value = doc.createElementNS(NS.a, 'a:t');
      value.appendChild(doc.createTextNode(line));
      run.appendChild(value);
      paragraph.appendChild(run);
      container.appendChild(paragraph);
    }
    return;
  }

  if (values[0] && lines.length === 1) {
    values[0].textContent = text;
    const staleContainers = new Set<Element>();
    for (const value of values.slice(1)) {
      const containerEl = textContainer(value, node);
      if (containerEl) staleContainers.add(containerEl);
      else value.parentNode?.removeChild(value);
    }
    for (const containerEl of staleContainers) containerEl.parentNode?.removeChild(containerEl);
    return;
  }

  if (values[0]) {
    // Multi-line without txBody: replace first t and drop other runs, then split via paragraphs on parent.
    const parent = values[0].parentNode?.parentNode as Element | null;
    if (parent?.localName === 'p' && parent.parentNode) {
      const host = parent.parentNode as Element;
      for (const child of [...children(host)]) if (child.localName === 'p') host.removeChild(child);
      for (const line of lines) {
        const paragraph = doc.createElementNS(NS.a, 'a:p');
        const run = doc.createElementNS(NS.a, 'a:r');
        if (rPrTemplate) run.appendChild(rPrTemplate.cloneNode(true));
        const value = doc.createElementNS(NS.a, 'a:t');
        value.appendChild(doc.createTextNode(line));
        run.appendChild(value);
        paragraph.appendChild(run);
        host.appendChild(paragraph);
      }
      return;
    }
  }

  for (const line of lines) {
    const paragraph = doc.createElementNS(NS.a, 'a:p'),
      run = doc.createElementNS(NS.a, 'a:r'),
      value = doc.createElementNS(NS.a, 'a:t');
    value.appendChild(doc.createTextNode(line));
    run.appendChild(value);
    paragraph.appendChild(run);
    node.appendChild(paragraph);
  }
};

export interface TextBlockStyle {
  readonly text: string;
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly textColor?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly align?: string;
}

const normalizeAlign = (align: string | undefined): string | undefined => {
  if (!align) return undefined;
  const map: Record<string, string> = {
    left: 'l',
    l: 'l',
    center: 'ctr',
    ctr: 'ctr',
    right: 'r',
    r: 'r',
    justify: 'just',
    just: 'just',
  };
  return map[align] ?? align;
};

const buildRunPr = (doc: Document, block: TextBlockStyle): Element => {
  const rPr = doc.createElementNS(NS.a, 'a:rPr');
  rPr.setAttribute('lang', 'en-US');
  if (block.fontSize !== undefined)
    rPr.setAttribute('sz', String(Math.round(block.fontSize * 100)));
  if (block.bold) rPr.setAttribute('b', '1');
  if (block.italic) rPr.setAttribute('i', '1');
  if (block.underline) rPr.setAttribute('u', 'sng');
  if (block.fontFamily) {
    const latin = doc.createElementNS(NS.a, 'a:latin');
    latin.setAttribute('typeface', block.fontFamily);
    rPr.appendChild(latin);
    const ea = doc.createElementNS(NS.a, 'a:ea');
    ea.setAttribute('typeface', block.fontFamily);
    rPr.appendChild(ea);
  }
  if (block.textColor) {
    const hex = block.textColor.replace(/^#/, '').toUpperCase();
    const solid = doc.createElementNS(NS.a, 'a:solidFill');
    const srgb = doc.createElementNS(NS.a, 'a:srgbClr');
    srgb.setAttribute('val', hex);
    solid.appendChild(srgb);
    if (rPr.firstChild) rPr.insertBefore(solid, rPr.firstChild);
    else rPr.appendChild(solid);
  }
  return rPr;
};

/** Write styled paragraph blocks (one `a:p` per block) into a shape/notes txBody. */
export const setNodeTextBlocks = (node: Node, blocks: readonly TextBlockStyle[]): void => {
  const doc = node.ownerDocument;
  if (!doc) throw new Error('Node has no document');
  let container = paragraphContainer(node);
  if (!container) {
    if (node.nodeType === 1) {
      container = doc.createElementNS(NS.a, 'a:txBody');
      container.appendChild(doc.createElementNS(NS.a, 'a:bodyPr'));
      container.appendChild(doc.createElementNS(NS.a, 'a:lstStyle'));
      (node as Element).appendChild(container);
    } else throw new Error('Cannot locate txBody for rich text blocks');
  }
  for (const child of [...children(container)])
    if (child.localName === 'p') container.removeChild(child);
  for (const block of blocks) {
    const paragraph = doc.createElementNS(NS.a, 'a:p');
    const align = normalizeAlign(block.align);
    if (align) {
      const pPr = doc.createElementNS(NS.a, 'a:pPr');
      pPr.setAttribute('algn', align);
      paragraph.appendChild(pPr);
    }
    const run = doc.createElementNS(NS.a, 'a:r');
    run.appendChild(buildRunPr(doc, block));
    const t = doc.createElementNS(NS.a, 'a:t');
    t.appendChild(doc.createTextNode(block.text));
    run.appendChild(t);
    paragraph.appendChild(run);
    container.appendChild(paragraph);
  }
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
