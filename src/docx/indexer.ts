import { createHash } from 'node:crypto';
import { err, ok, type Result } from '../core/index.js';
import type { Document, Element } from '@xmldom/xmldom';
import { parseXml, type OpcArchive } from '../opc/index.js';
import { parseTargetPath } from './addressing.js';
import { collectSpans, visibleRuns } from './text-spans.js';
import type { ElementKind, IndexFile, IndexedElement } from './types.js';
import {
  DOCUMENT_PART,
  STYLES_PART,
  attr,
  children,
  descendants,
  documentBody,
  paraIdOf,
  protectionReason,
} from './xml.js';

export interface DomHit {
  partUri: string;
  kind: ElementKind;
  path: string;
  element: Element;
  text?: string;
  name?: string;
  paraId?: string;
  protected: boolean;
  parentPath?: string;
  location: Record<string, string | number>;
}

const bookmarkNames = (paragraph: Element): string[] =>
  children(paragraph)
    .filter((child) => child.localName === 'bookmarkStart')
    .map((child) => attr(child, 'w:name'))
    .filter((name): name is string => name !== undefined && name !== '_GoBack');

const paragraphStyle = (paragraph: Element): string | undefined => {
  const pPr = children(paragraph).find((child) => child.localName === 'pPr');
  const pStyle = pPr ? children(pPr).find((child) => child.localName === 'pStyle') : undefined;
  return attr(pStyle, 'w:val');
};

const pushParagraph = (
  hits: DomHit[],
  paragraph: Element,
  path: string,
  protectedFlag: boolean,
  wrapping: string[],
  location: Record<string, string | number>,
  parentPath?: string,
): void => {
  const names = [...wrapping, ...bookmarkNames(paragraph)];
  const text = collectSpans(paragraph).text;
  const paraId = paraIdOf(paragraph);
  const style = paragraphStyle(paragraph);
  const protectedNode = protectedFlag || protectionReason(paragraph) !== undefined;
  hits.push({
    partUri: DOCUMENT_PART,
    kind: 'paragraph',
    path,
    element: paragraph,
    ...(text.length > 0 ? { text } : {}),
    ...(names[0] ? { name: names[0] } : {}),
    ...(paraId ? { paraId } : {}),
    protected: protectedNode,
    ...(parentPath ? { parentPath } : {}),
    location: { ...location, ...(style ? { style } : {}), ...(paraId ? { paraId } : {}) },
  });
  for (const name of names) {
    hits.push({
      partUri: DOCUMENT_PART,
      kind: 'bookmark',
      path: `bookmark:${name}`,
      element: paragraph,
      name,
      ...(text.length > 0 ? { text } : {}),
      protected: protectedNode,
      parentPath: path,
      location: { bookmark: name },
    });
  }
  visibleRuns(paragraph).forEach((run, index) => {
    const runText = collectSpans(paragraph)
      .spans.filter((span) => span.run === run)
      .map((span) => span.node.textContent ?? '')
      .join('');
    hits.push({
      partUri: DOCUMENT_PART,
      kind: 'run',
      path: `${path}/run:${String(index)}`,
      element: run,
      ...(runText.length > 0 ? { text: runText } : {}),
      protected: protectedNode || protectionReason(run) !== undefined,
      parentPath: path,
      location: { run: index },
    });
  });
};

const indexTable = (
  hits: DomHit[],
  table: Element,
  path: string,
  protectedFlag: boolean,
  names: string[],
): void => {
  hits.push({
    partUri: DOCUMENT_PART,
    kind: 'table',
    path,
    element: table,
    ...(names[0] ? { name: names[0] } : {}),
    protected: protectedFlag || protectionReason(table) !== undefined,
    location: { table: path },
  });
  for (const name of names) {
    hits.push({
      partUri: DOCUMENT_PART,
      kind: 'bookmark',
      path: `bookmark:${name}`,
      element: table,
      name,
      protected: protectedFlag,
      parentPath: path,
      location: { bookmark: name },
    });
  }
  let row = 0;
  for (const tr of children(table)) {
    if (tr.localName !== 'tr') continue;
    row += 1;
    let cell = 0;
    for (const tc of children(tr)) {
      if (tc.localName !== 'tc') continue;
      cell += 1;
      const cellPath = `${path}/row:${String(row)}/cell:${String(cell)}`;
      const cellText = children(tc)
        .filter((child) => child.localName === 'p')
        .map((child) => collectSpans(child).text)
        .join('\n');
      hits.push({
        partUri: DOCUMENT_PART,
        kind: 'tableCell',
        path: cellPath,
        element: tc,
        ...(cellText.length > 0 ? { text: cellText } : {}),
        protected: protectedFlag || protectionReason(tc) !== undefined,
        parentPath: path,
        location: { row, cell },
      });
      let paragraph = 0;
      for (const child of children(tc)) {
        if (child.localName !== 'p') continue;
        paragraph += 1;
        pushParagraph(
          hits,
          child,
          `${cellPath}/p:${String(paragraph)}`,
          protectedFlag || protectionReason(tc) !== undefined,
          [],
          { table: path, row, cell, paragraph },
          cellPath,
        );
      }
    }
  }
};

interface BodyCounters {
  paragraph: number;
  table: number;
}

const walkBody = (
  body: Element,
  hits: DomHit[],
  inheritedProtected: boolean,
  counters: BodyCounters,
): void => {
  const open: { id: string; name: string }[] = [];
  for (const child of children(body)) {
    const name = child.localName;
    if (name === 'bookmarkStart') {
      const id = attr(child, 'w:id');
      const bookmark = attr(child, 'w:name');
      if (id && bookmark && bookmark !== '_GoBack') open.push({ id, name: bookmark });
      continue;
    }
    if (name === 'bookmarkEnd') {
      const id = attr(child, 'w:id');
      const index = open.findIndex((item) => item.id === id);
      if (index >= 0) open.splice(index, 1);
      continue;
    }
    if (name === 'sdt') {
      const content = children(child).find((item) => item.localName === 'sdtContent');
      if (content) walkBody(content, hits, true, counters);
      continue;
    }
    if (name === 'sectPr' || name === 'proofErr') continue;
    const wrapping = open.map((item) => item.name);
    if (name === 'p') {
      counters.paragraph += 1;
      pushParagraph(
        hits,
        child,
        `body/p:${String(counters.paragraph)}`,
        inheritedProtected,
        wrapping,
        { paragraph: counters.paragraph },
      );
      continue;
    }
    if (name === 'tbl') {
      counters.table += 1;
      indexTable(hits, child, `body/table:${String(counters.table)}`, inheritedProtected, wrapping);
    }
  }
};

const walkStyles = (doc: Document | undefined, hits: DomHit[]): void => {
  if (!doc) return;
  for (const style of descendants(doc, 'style')) {
    const styleId = attr(style, 'w:styleId');
    if (!styleId) continue;
    const display = children(style).find((child) => child.localName === 'name');
    const name = attr(display, 'w:val') ?? styleId;
    const typeName = attr(style, 'w:type');
    hits.push({
      partUri: STYLES_PART,
      kind: 'style',
      path: `style:${styleId}`,
      element: style,
      name,
      text: name,
      protected: true,
      location: { styleId, ...(typeName ? { type: typeName } : {}) },
    });
  }
};

const walkSections = (body: Element, hits: DomHit[]): void => {
  const sections = descendants(body, 'sectPr');
  sections.forEach((section, index) => {
    hits.push({
      partUri: DOCUMENT_PART,
      kind: 'section',
      path: `section:${String(index + 1)}`,
      element: section,
      protected: true,
      location: { section: index + 1 },
    });
  });
};

export const readDocument = (archive: OpcArchive): Document | undefined => {
  const part = archive.getPart(DOCUMENT_PART);
  if (!part) return undefined;
  return parseXml(part.data);
};

export const hitsFrom = (document: Document, styles: Document | undefined): DomHit[] => {
  const hits: DomHit[] = [];
  const body = documentBody(document);
  walkBody(body, hits, false, { paragraph: 0, table: 0 });
  walkSections(body, hits);
  walkStyles(styles, hits);
  return hits;
};

export const collectHits = (archive: OpcArchive): DomHit[] => {
  const document = readDocument(archive);
  if (!document) return [];
  const stylesPart = archive.getPart(STYLES_PART);
  return hitsFrom(document, stylesPart ? parseXml(stylesPart.data) : undefined);
};

const stableUid = (documentId: string, partUri: string, key: string, kind: string): string => {
  const hash = createHash('sha1').update(`${documentId}|${partUri}|${key}|${kind}`).digest('hex');
  const prefix =
    kind === 'paragraph'
      ? 'par'
      : kind === 'run'
        ? 'run'
        : kind === 'table'
          ? 'tbl'
          : kind === 'style'
            ? 'sty'
            : kind === 'bookmark'
              ? 'bmk'
              : 'wrd';
  return `du:${prefix}:${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
};

const toIndexed = (hit: DomHit, documentId: string): IndexedElement => ({
  ref: {
    documentId,
    elementId: stableUid(documentId, hit.partUri, hit.paraId ?? hit.path, hit.kind),
    path: hit.path,
  },
  kind: hit.kind,
  partUri: hit.partUri,
  ...(hit.name ? { name: hit.name } : {}),
  ...(hit.text !== undefined ? { text: hit.text } : {}),
  ...(hit.parentPath ? { parentId: hit.parentPath } : {}),
  location: hit.location,
  payload: {
    ...(hit.paraId ? { paraId: hit.paraId } : {}),
    protected: hit.protected,
    ...(typeof hit.location['style'] === 'string' ? { style: hit.location['style'] } : {}),
  },
});

export const buildIndex = (
  archive: OpcArchive,
  documentId: string,
  revision: string,
): IndexFile => ({
  revision,
  elements: collectHits(archive).map((hit) => toIndexed(hit, documentId)),
});

export const resolveItem = (index: IndexFile, target: string): Result<IndexedElement> => {
  const trimmed = target.trim();
  if (!trimmed) return err('INVALID_COMMAND', 'Target path is empty');
  const byUid = index.elements.filter((item) => item.ref.elementId === trimmed);
  if (byUid.length > 1)
    return err('AMBIGUOUS_REFERENCE', `Target is ambiguous: ${trimmed}`, [], { target: trimmed });
  const unique = byUid[0];
  if (unique) return ok(unique);

  const parsed = parseTargetPath(trimmed);
  if (!parsed.ok) return parsed;
  if (parsed.value.kind === 'paraId') {
    const matches = index.elements.filter(
      (item) => item.kind === 'paragraph' && item.payload?.['paraId'] === parsed.value.paraId,
    );
    if (matches.length > 1)
      return err('AMBIGUOUS_REFERENCE', `paraId is ambiguous: ${parsed.value.paraId ?? ''}`, [], {
        target: trimmed,
      });
    const found = matches[0];
    if (!found)
      return err('TARGET_NOT_FOUND', `Target not found: ${trimmed}`, [], {
        target: trimmed,
        hint: 'List paragraphs to see w14:paraId values.',
      });
    return ok(found);
  }
  if (parsed.value.kind === 'body')
    return err('INVALID_COMMAND', 'body is a container, not an editable target', [], {
      target: trimmed,
      hint: 'Target body/p:<n> or body/table:<n>.',
    });

  const matches = index.elements.filter((item) => item.ref.path === trimmed);
  if (matches.length > 1)
    return err('AMBIGUOUS_REFERENCE', `Target is ambiguous: ${trimmed}`, [], { target: trimmed });
  const found = matches[0];
  if (!found)
    return err('TARGET_NOT_FOUND', `Target not found: ${trimmed}`, [], {
      target: trimmed,
      hint: 'Use deckuse list paragraphs, tables, styles, or bookmarks.',
    });
  return ok(found);
};

export interface LocatedTarget {
  item: IndexedElement;
  element: Element;
  doc: Document;
  partUri: string;
}

export const locate = (
  archive: OpcArchive,
  index: IndexFile,
  target: string,
): Result<LocatedTarget> => {
  const resolved = resolveItem(index, target);
  if (!resolved.ok) return resolved;
  const part = archive.getPart(resolved.value.partUri);
  if (!part)
    return err('TARGET_NOT_FOUND', `Missing part ${resolved.value.partUri}`, [], { target });
  const doc = parseXml(part.data);
  const hits =
    resolved.value.partUri === STYLES_PART
      ? hitsFrom(
          parseXml(
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
          ),
          doc,
        )
      : hitsFrom(doc, undefined);
  const live = hits.find((item) => item.path === resolved.value.ref.path);
  if (!live) return err('TARGET_NOT_FOUND', `Target not found: ${target}`, [], { target });
  return ok({
    item: resolved.value,
    element: live.element,
    doc: resolved.value.partUri === STYLES_PART ? doc : doc,
    partUri: resolved.value.partUri,
  });
};

export const findIndexed = (
  index: IndexFile,
  ref: { elementId?: string | undefined; path?: string | undefined },
): IndexedElement | undefined =>
  index.elements.find(
    (item) =>
      (ref.elementId !== undefined && item.ref.elementId === ref.elementId) ||
      (ref.path !== undefined && item.ref.path === ref.path),
  );

export function matchesSelector(
  item: IndexedElement,
  selector:
    | string
    | {
        kind?: string | undefined;
        name?: string | undefined;
        text?: string | undefined;
        textRegex?: string | undefined;
        id?: string | undefined;
        hasText?: boolean | undefined;
      },
): boolean {
  if (typeof selector === 'string' && (selector === '*' || selector === 'all')) return true;
  if (typeof selector === 'string' && !selector.includes('=')) {
    const needle = selector.toLowerCase();
    return (
      item.ref.path === selector ||
      item.kind === selector ||
      (item.text?.toLowerCase().includes(needle) ?? false) ||
      (item.name?.toLowerCase().includes(needle) ?? false)
    );
  }
  const spec: {
    kind?: string | undefined;
    name?: string | undefined;
    text?: string | undefined;
    textRegex?: string | undefined;
    id?: string | undefined;
    hasText?: boolean | string | undefined;
  } =
    typeof selector === 'string'
      ? Object.fromEntries(
          selector.split(/\s+/).map((part) => {
            const indexOfEq = part.indexOf('=');
            return [part.slice(0, indexOfEq), part.slice(indexOfEq + 1)];
          }),
        )
      : selector;
  if (spec.kind && spec.kind !== item.kind) return false;
  if (spec.name && item.name !== spec.name) return false;
  if (spec.id && item.payload?.['paraId'] !== spec.id && item.ref.elementId !== spec.id)
    return false;
  if (spec.text && !(item.text?.toLowerCase().includes(spec.text.toLowerCase()) ?? false))
    return false;
  if (spec.textRegex) {
    const regex = new RegExp(spec.textRegex, 'i');
    if (!regex.test(item.text ?? '')) return false;
  }
  if (spec.hasText === true && !(item.text && item.text.length > 0)) return false;
  if (spec.hasText === false && item.text && item.text.length > 0) return false;
  return true;
}
