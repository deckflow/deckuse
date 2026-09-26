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

/** Placeholder types that are never speaker-note body content. */
const NOTES_NON_BODY_PH = new Set(['hdr', 'ftr', 'dt', 'sldNum', 'sldImg']);

/**
 * Locate the speaker-notes body shape under a notes slide root.
 * Prefers `p:ph type="body"`; otherwise the first shape that is not a
 * header/footer/date/slide-number placeholder. Never returns hdr/sldNum/etc.
 */
export const notesBodyShape = (notesRoot: Node): Element | undefined => {
  const shapes = descendants(notesRoot, 'sp');
  let fallback: Element | undefined;
  for (const sp of shapes) {
    const ph = first(sp, 'ph');
    if (!ph) {
      fallback ??= sp;
      continue;
    }
    const type = attr(ph, 'type') ?? 'body';
    if (type === 'body') return sp;
    if (!NOTES_NON_BODY_PH.has(type)) fallback ??= sp;
  }
  return fallback;
};

/** Speaker-note body text only (excludes header / slide number placeholders). */
export const notesBodyText = (notesRoot: Node): string => {
  const body = notesBodyShape(notesRoot);
  return body ? textOf(body) : '';
};

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

/** Replace text under a node. Newlines become separate `a:p` paragraphs; first-run `rPr` and paragraph `pPr` are preserved. */
export const setNodeText = (node: Node, text: string): void => {
  const doc = node.ownerDocument;
  if (!doc) throw new Error('Node has no document');
  const lines = text.split('\n');
  const values = descendants(node, 't');
  let rPrTemplate: Element | undefined;
  if (values[0]) {
    const run = textContainer(values[0], node);
    if (run)
      rPrTemplate = cloneRPr(
        doc,
        children(run).find((c) => c.localName === 'rPr'),
      );
  }

  const container = paragraphContainer(node);
  if (container) {
    const oldParagraphs = children(container).filter((c) => c.localName === 'p');
    const pPrTemplates = oldParagraphs.map((p) => children(p).find((c) => c.localName === 'pPr'));
    for (const child of [...children(container)])
      if (child.localName === 'p') container.removeChild(child);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const paragraph = doc.createElementNS(NS.a, 'a:p');
      const pPrSource =
        pPrTemplates[i] ?? pPrTemplates[pPrTemplates.length - 1] ?? pPrTemplates[0];
      if (pPrSource) paragraph.appendChild(pPrSource.cloneNode(true));
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

export interface TextRunStyle {
  readonly text: string;
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly textColor?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
}

export interface TextBlockStyle {
  readonly text?: string;
  readonly runs?: readonly TextRunStyle[];
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly textColor?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly align?: string;
}

export const normalizeAlign = (align: string | undefined): string | undefined => {
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

const buildRunPr = (doc: Document, block: TextRunStyle): Element => {
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

const appendRun = (doc: Document, paragraph: Element, style: TextRunStyle): void => {
  const run = doc.createElementNS(NS.a, 'a:r');
  run.appendChild(buildRunPr(doc, style));
  const t = doc.createElementNS(NS.a, 'a:t');
  t.appendChild(doc.createTextNode(style.text));
  run.appendChild(t);
  paragraph.appendChild(run);
};

const splitLines = (text: string): string[] =>
  text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

/**
 * Expand blocks so no `a:t` contains raw newlines: `\n` becomes additional paragraphs
 * (same semantics as `setNodeText`).
 */
export const normalizeTextBlocksNewlines = (
  blocks: readonly TextBlockStyle[],
): TextBlockStyle[] => {
  const out: TextBlockStyle[] = [];
  for (const block of blocks) {
    const blockStyle = {
      ...(block.fontSize !== undefined ? { fontSize: block.fontSize } : {}),
      ...(block.fontFamily !== undefined ? { fontFamily: block.fontFamily } : {}),
      ...(block.textColor !== undefined ? { textColor: block.textColor } : {}),
      ...(block.bold !== undefined ? { bold: block.bold } : {}),
      ...(block.italic !== undefined ? { italic: block.italic } : {}),
      ...(block.underline !== undefined ? { underline: block.underline } : {}),
      ...(block.align !== undefined ? { align: block.align } : {}),
    };
    if (block.runs && block.runs.length > 0) {
      let currentRuns: TextRunStyle[] = [];
      const flush = (): void => {
        out.push({
          ...blockStyle,
          runs: currentRuns.length > 0 ? currentRuns : [{ text: '' }],
        });
        currentRuns = [];
      };
      for (const run of block.runs) {
        const lines = splitLines(run.text);
        for (let i = 0; i < lines.length; i++) {
          if (i > 0) flush();
          currentRuns.push({
            ...run,
            text: lines[i]!,
          });
        }
      }
      flush();
      continue;
    }
    const lines = splitLines(block.text ?? '');
    for (const line of lines) {
      out.push({
        ...blockStyle,
        text: line,
      });
    }
  }
  return out;
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
  const normalized = normalizeTextBlocksNewlines(blocks);
  for (const block of normalized) {
    const paragraph = doc.createElementNS(NS.a, 'a:p');
    const align = normalizeAlign(block.align);
    if (align) {
      const pPr = doc.createElementNS(NS.a, 'a:pPr');
      pPr.setAttribute('algn', align);
      paragraph.appendChild(pPr);
    }
    if (block.runs && block.runs.length > 0) {
      for (const run of block.runs) appendRun(doc, paragraph, run);
    } else {
      appendRun(doc, paragraph, {
        text: block.text ?? '',
        ...(block.fontSize !== undefined ? { fontSize: block.fontSize } : {}),
        ...(block.fontFamily !== undefined ? { fontFamily: block.fontFamily } : {}),
        ...(block.textColor !== undefined ? { textColor: block.textColor } : {}),
        ...(block.bold !== undefined ? { bold: block.bold } : {}),
        ...(block.italic !== undefined ? { italic: block.italic } : {}),
        ...(block.underline !== undefined ? { underline: block.underline } : {}),
      });
    }
    container.appendChild(paragraph);
  }
};

const ensureBodyPr = (shape: Element): Element => {
  const doc = shape.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  let txBody = paragraphContainer(shape);
  if (!txBody) {
    txBody = doc.createElementNS(NS.a, 'a:txBody');
    txBody.appendChild(doc.createElementNS(NS.a, 'a:bodyPr'));
    txBody.appendChild(doc.createElementNS(NS.a, 'a:lstStyle'));
    shape.appendChild(txBody);
  }
  let bodyPr = children(txBody).find((c) => c.localName === 'bodyPr');
  if (!bodyPr) {
    bodyPr = doc.createElementNS(NS.a, 'a:bodyPr');
    if (txBody.firstChild) txBody.insertBefore(bodyPr, txBody.firstChild);
    else txBody.appendChild(bodyPr);
  }
  return bodyPr;
};

export const normalizeTextAnchor = (value: string): string => {
  const map: Record<string, string> = {
    t: 't',
    top: 't',
    ctr: 'ctr',
    middle: 'ctr',
    center: 'ctr',
    b: 'b',
    bottom: 'b',
  };
  const normalized = map[value];
  if (!normalized) throw new Error(`anchor must be one of t, ctr, b (or top, middle, bottom)`);
  return normalized;
};

/** Set a:bodyPr vertical anchor and/or wrap. */
export const setBodyPrOptions = (
  shape: Element,
  options: { anchor?: string; wrap?: string },
): void => {
  const bodyPr = ensureBodyPr(shape);
  if (options.anchor !== undefined)
    bodyPr.setAttribute('anchor', normalizeTextAnchor(options.anchor));
  if (options.wrap !== undefined) {
    if (options.wrap !== 'none' && options.wrap !== 'square')
      throw new Error('wrap must be "none" or "square"');
    bodyPr.setAttribute('wrap', options.wrap);
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
