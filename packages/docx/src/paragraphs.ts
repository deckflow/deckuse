import { randomBytes } from 'node:crypto';
import type { TextBlock } from '@deckflow/deckuse-core';
import { err, ok, type Result } from '@deckflow/deckuse-core';
import type { Document, Element, Node } from '@xmldom/xmldom';
import { applyRunProps, setParagraphStyle, type RunProps } from './properties.js';
import {
  attr,
  children,
  descendants,
  documentBody,
  ensureW14,
  paraIdOf,
  protectionReason,
  wEl,
  writeTextNode,
} from './xml.js';

const BOOKMARK_NAME = /^[A-Za-z_][\w.-]{0,39}$/;

export const assertBookmarkName = (name: string): Result<string> => {
  if (!BOOKMARK_NAME.test(name)) {
    return err('INVALID_COMMAND', `Invalid bookmark name: ${name}`, [], {
      hint: 'Bookmark names start with a letter or underscore and contain no spaces.',
    });
  }
  return ok(name);
};

export const bookmarkExists = (doc: Document, name: string): boolean =>
  descendants(doc, 'bookmarkStart').some((node) => attr(node, 'w:name') === name);

export const nextBookmarkId = (doc: Document): string => {
  let max = 0;
  for (const node of descendants(doc, 'bookmarkStart')) {
    const id = Number(attr(node, 'w:id'));
    if (Number.isInteger(id) && id > max) max = id;
  }
  return String(max + 1);
};

export const ensureParaId = (paragraph: Element): void => {
  const doc = paragraph.ownerDocument;
  if (!doc) return;
  if (paraIdOf(paragraph)) {
    ensureW14(doc);
    return;
  }
  const used = new Set(
    descendants(doc, 'p')
      .map((item) => paraIdOf(item))
      .filter((item): item is string => item !== undefined),
  );
  let id = randomBytes(4).toString('hex').toUpperCase();
  while (used.has(id)) id = randomBytes(4).toString('hex').toUpperCase();
  ensureW14(doc);
  paragraph.setAttribute('w14:paraId', id);
};

const clearVisibleRuns = (paragraph: Element): void => {
  for (const child of [...children(paragraph)]) {
    const name = child.localName;
    if (name === 'r' || name === 'hyperlink' || name === 'smartTag' || name === 'proofErr')
      paragraph.removeChild(child);
  }
};

export const appendRun = (paragraph: Element, text: string, props?: RunProps): Result<true> => {
  const doc = paragraph.ownerDocument;
  if (!doc) return err('INTERNAL_ERROR', 'Paragraph has no document');
  const run = wEl(doc, 'r');
  paragraph.appendChild(run);
  if (props) {
    const applied = applyRunProps(run, props);
    if (!applied.ok) return applied;
  }
  const textNode = wEl(doc, 't');
  writeTextNode(textNode, text);
  run.appendChild(textNode);
  return ok(true);
};

const runPropsFromBlock = (block: TextBlock): RunProps => {
  const props: RunProps = {};
  if (block.fontSize !== undefined) props.fontSize = block.fontSize;
  if (block.fontFamily !== undefined) props.fontFamily = block.fontFamily;
  if (block.textColor !== undefined) props.textColor = block.textColor;
  if (block.bold !== undefined) props.bold = block.bold;
  if (block.italic !== undefined) props.italic = block.italic;
  if (block.underline !== undefined) props.underline = block.underline;
  return props;
};

export const fillParagraph = (
  paragraph: Element,
  block: TextBlock,
  styleId?: string,
): Result<true> => {
  const reason = protectionReason(paragraph);
  if (reason) return err('UNSUPPORTED_CAPABILITY', reason);
  if (styleId) setParagraphStyle(paragraph, styleId);
  clearVisibleRuns(paragraph);
  const blockProps = runPropsFromBlock(block);
  if (block.runs) {
    for (const run of block.runs) {
      const appended = appendRun(paragraph, run.text, {
        ...blockProps,
        ...(run.fontSize !== undefined ? { fontSize: run.fontSize } : {}),
        ...(run.fontFamily !== undefined ? { fontFamily: run.fontFamily } : {}),
        ...(run.textColor !== undefined ? { textColor: run.textColor } : {}),
        ...(run.bold !== undefined ? { bold: run.bold } : {}),
        ...(run.italic !== undefined ? { italic: run.italic } : {}),
        ...(run.underline !== undefined ? { underline: run.underline } : {}),
      });
      if (!appended.ok) return appended;
    }
  } else {
    const appended = appendRun(paragraph, block.text ?? '', blockProps);
    if (!appended.ok) return appended;
  }
  if (block.align) {
    const applied = setAlignLocal(paragraph, block.align);
    if (!applied.ok) return applied;
  }
  ensureParaId(paragraph);
  return ok(true);
};

const setAlignLocal = (paragraph: Element, align: string): Result<true> => {
  const mapped: Record<string, string> = {
    l: 'left',
    left: 'left',
    ctr: 'center',
    center: 'center',
    r: 'right',
    right: 'right',
    just: 'both',
    justify: 'both',
  };
  const value = mapped[align];
  if (!value) return err('INVALID_COMMAND', `Unsupported align: ${align}`);
  const doc = paragraph.ownerDocument;
  if (!doc) return err('INTERNAL_ERROR', 'Paragraph has no document');
  let pPr = children(paragraph).find((child) => child.localName === 'pPr');
  if (!pPr) {
    pPr = wEl(doc, 'pPr');
    paragraph.insertBefore(pPr, paragraph.firstChild);
  }
  let jc = children(pPr).find((child) => child.localName === 'jc');
  if (!jc) {
    jc = wEl(doc, 'jc');
    pPr.appendChild(jc);
  }
  jc.setAttribute('w:val', value);
  return ok(true);
};

export const setPlainText = (paragraph: Element, text: string): Result<Element[]> => {
  const reason = protectionReason(paragraph);
  if (reason) return err('UNSUPPORTED_CAPABILITY', reason);
  const lines = text.split('\n');
  const first = lines[0] ?? '';
  clearVisibleRuns(paragraph);
  if (first.length > 0) {
    const appended = appendRun(paragraph, first);
    if (!appended.ok) return appended;
  }
  ensureParaId(paragraph);
  const doc = paragraph.ownerDocument;
  if (!doc) return err('INTERNAL_ERROR', 'Paragraph has no document');
  const extras: Element[] = [];
  for (const line of lines.slice(1)) {
    const created = wEl(doc, 'p');
    if (line.length > 0) {
      const appended = appendRun(created, line);
      if (!appended.ok) return appended;
    }
    ensureParaId(created);
    extras.push(created);
  }
  return ok(extras);
};

const placeBookmark = (paragraph: Element, id: string, name: string): void => {
  const doc = paragraph.ownerDocument;
  if (!doc) return;
  const start = wEl(doc, 'bookmarkStart');
  start.setAttribute('w:id', id);
  start.setAttribute('w:name', name);
  const end = wEl(doc, 'bookmarkEnd');
  end.setAttribute('w:id', id);
  const pPr = children(paragraph).find((child) => child.localName === 'pPr');
  if (pPr?.nextSibling) paragraph.insertBefore(start, pPr.nextSibling);
  else if (pPr) paragraph.appendChild(start);
  else if (paragraph.firstChild) paragraph.insertBefore(start, paragraph.firstChild);
  else paragraph.appendChild(start);
  paragraph.appendChild(end);
};

export const createParagraphs = (
  doc: Document,
  options: {
    text?: string;
    blocks?: TextBlock[];
    styleId?: string;
    bookmark?: { id: string; name: string };
  },
): Result<Element[]> => {
  const blocks: TextBlock[] =
    options.blocks ??
    (options.text !== undefined
      ? options.text.split('\n').map((text) => ({ text }))
      : [{ text: '' }]);
  const created: Element[] = [];
  for (const [index, block] of blocks.entries()) {
    const paragraph = wEl(doc, 'p');
    const filled = fillParagraph(paragraph, block, options.styleId);
    if (!filled.ok) return filled;
    if (index === 0 && options.bookmark)
      placeBookmark(paragraph, options.bookmark.id, options.bookmark.name);
    created.push(paragraph);
  }
  return ok(created);
};

export const createPageBreak = (doc: Document): Element => {
  const paragraph = wEl(doc, 'p');
  const run = wEl(doc, 'r');
  const br = wEl(doc, 'br');
  br.setAttribute('w:type', 'page');
  run.appendChild(br);
  paragraph.appendChild(run);
  ensureParaId(paragraph);
  return paragraph;
};

export const insertAfter = (
  anchor: Element | undefined,
  blocks: Element[],
  doc: Document,
): void => {
  if (blocks.length === 0) return;
  if (!anchor) {
    const body = documentBody(doc);
    const sect = children(body).find((child) => child.localName === 'sectPr');
    for (const block of blocks) {
      if (sect) body.insertBefore(block, sect);
      else body.appendChild(block);
    }
    return;
  }
  const parent = anchor.parentNode;
  if (!parent) throw new Error('Insert anchor has no parent');
  let cursor: Node = anchor;
  for (const block of blocks) {
    const next = cursor.nextSibling;
    if (next) parent.insertBefore(block, next);
    else parent.appendChild(block);
    cursor = block;
  }
};

export const blockAnchor = (element: Element): Element => {
  if (element.localName !== 'r') return element;
  let current: Node | null = element;
  while (current?.nodeType !== 1 || (current as Element).localName !== 'p') {
    if (!current) break;
    current = current.parentNode;
  }
  return current?.nodeType === 1 ? (current as Element) : element;
};

export const removeElement = (element: Element): Result<true> => {
  if (element.localName === 'p') {
    const pPr = children(element).find((child) => child.localName === 'pPr');
    if (pPr && children(pPr).some((child) => child.localName === 'sectPr')) {
      return err(
        'UNSUPPORTED_CAPABILITY',
        'This paragraph owns section properties and cannot be removed',
        [],
        { hint: 'Section breaks are preserved. Remove a different paragraph.' },
      );
    }
  }
  if (element.localName === 'tr') {
    const table = element.parentNode;
    if (table?.nodeType === 1) {
      const rows = children(table as Element).filter((child) => child.localName === 'tr');
      if (rows.length <= 1)
        return err('VALIDATION_FAILED', 'A table must keep at least one row', [], {
          hint: 'Remove the table instead of its last row.',
        });
    }
  }
  const parent = element.parentNode;
  if (!parent) return err('TARGET_NOT_FOUND', 'Element has no parent');
  if (element.localName === 'tbl') {
    const previous = element.previousSibling;
    const next = element.nextSibling;
    parent.removeChild(element);
    const start =
      previous?.nodeType === 1 && (previous as Element).localName === 'bookmarkStart'
        ? (previous as Element)
        : undefined;
    const end =
      next?.nodeType === 1 && (next as Element).localName === 'bookmarkEnd'
        ? (next as Element)
        : undefined;
    if (start && end && attr(start, 'w:id') === attr(end, 'w:id')) {
      parent.removeChild(start);
      parent.removeChild(end);
    }
    return ok(true);
  }
  parent.removeChild(element);
  return ok(true);
};

export const removeBookmark = (doc: Document, name: string): Result<true> => {
  const starts = descendants(doc, 'bookmarkStart').filter((node) => attr(node, 'w:name') === name);
  if (starts.length === 0) return err('TARGET_NOT_FOUND', `Bookmark not found: ${name}`);
  if (starts.length > 1) return err('AMBIGUOUS_REFERENCE', `Bookmark is ambiguous: ${name}`);
  const start = starts[0];
  if (!start) return err('TARGET_NOT_FOUND', `Bookmark not found: ${name}`);
  const id = attr(start, 'w:id');
  const end = descendants(doc, 'bookmarkEnd').find((node) => attr(node, 'w:id') === id);
  start.parentNode?.removeChild(start);
  end?.parentNode?.removeChild(end);
  return ok(true);
};
