import {
  err,
  ok,
  parseLength,
  type AtomicCommand,
  type Diagnostic,
  type ElementRef,
  type LengthInput,
  type Result,
} from '@deckflow/deckuse-core';
import type { OpcArchive } from '@deckflow/deckuse-opc';
import type { Document, Element } from '@xmldom/xmldom';
import { resolveTarget, resolveToRef, cNvPrIdOf } from './addressing.js';
import { computeAlignUpdates, readBBox, writeBBox } from './align.js';
import { assertWritable } from './edition.js';
import { addElement, duplicateElement, updateChart } from './elements.js';
import { findIndexed, matchesSelector, mergeSlides, slidesForItem } from './indexer.js';
import { detachPictureAndCleanup, loadPictureBytes, replacePictureMedia } from './picture.js';
import { detachMediaAndCleanup } from './media.js';
import { applyShapeProperties, assertChartProperties } from './properties.js';
import { mapDottedProperties } from './resolve-properties.js';
import { addSlide, duplicateSlide, ensureNotes, removeSlide } from './slides.js';
import { lengthContextFor } from './slide-size.js';
import { normalizePlaceholderRole } from './placeholder-role.js';
import { applyTableCellProperties, applyTableProperties } from './table.js';
import type { IndexFile, IndexedElement, MutationOutcome } from './types.js';
import {
  REL,
  NS,
  attr,
  children,
  cNvPr,
  descendants,
  first,
  root,
  setNodeText,
  setNodeTextBlocks,
} from './xml.js';

const SHAPE_LOCAL_NAMES = new Set(['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp']);
const directChild = (node: Element, localName: string): Element | undefined =>
  children(node).find((child) => child.localName === localName);

const resolveLengthField = (
  archive: OpcArchive,
  value: LengthInput | undefined,
  axis: 'x' | 'y',
): number | undefined => {
  if (value === undefined) return undefined;
  return parseLength(value, lengthContextFor(archive, axis));
};

const normalizeTransformFields = (
  archive: OpcArchive,
  fields: Record<string, unknown>,
): Record<string, unknown> => {
  const out = { ...fields };
  for (const key of ['x', 'width'] as const) {
    if (out[key] !== undefined)
      out[key] = resolveLengthField(archive, out[key] as LengthInput, 'x');
  }
  for (const key of ['y', 'height'] as const) {
    if (out[key] !== undefined && out[key] !== 'auto')
      out[key] = resolveLengthField(archive, out[key] as LengthInput, 'y');
  }
  return out;
};

export const shapeByCNvPrId = (doc: Document, id: string): Element | undefined =>
  descendants(doc).find(
    (node) =>
      node.localName != null &&
      SHAPE_LOCAL_NAMES.has(node.localName) &&
      attr(cNvPr(node), 'id') === id,
  );
export const nodeFor = (doc: Document, item: IndexedElement): Element | undefined => {
  if (['slide', 'notes', 'master', 'layout', 'theme'].includes(item.kind)) return root(doc);
  if (item.kind === 'tableCell') {
    const rawTableId = item.location?.['tableId'],
      tableId = typeof rawTableId === 'string' ? rawTableId : '';
    // elementId is `${slideId}:${ancestorPath}` — strip slide prefix, then take the leaf cNvPr id.
    const afterSlide = tableId.includes(':') ? tableId.slice(tableId.indexOf(':') + 1) : tableId;
    const tableTail = afterSlide.split('.').at(-1) ?? afterSlide;
    if (!tableTail) return undefined;
    const table = shapeByCNvPrId(doc, tableTail);
    if (!table) return;
    const row = descendants(table, 'tr')[Number(item.location?.['row'])];
    return row ? descendants(row, 'tc')[Number(item.location?.['column'])] : undefined;
  }
  const id = cNvPrIdOf(item);
  return id ? shapeByCNvPrId(doc, id) : undefined;
};

const placeholderOf = (node: Element): { type: string; idx?: string } | undefined => {
  const ph = first(node, 'ph');
  if (!ph) return undefined;
  const type = attr(ph, 'type') ?? 'body';
  const idx = attr(ph, 'idx');
  return { type, ...(idx !== undefined ? { idx } : {}) };
};

const findPlaceholderXfrm = (
  doc: Document,
  type: string,
  idx: string | undefined,
): Element | undefined => {
  for (const shape of descendants(doc)) {
    if (!shape.localName || !SHAPE_LOCAL_NAMES.has(shape.localName)) continue;
    const ph = placeholderOf(shape);
    if (!ph) continue;
    if (idx !== undefined && ph.idx === idx) {
      const xfrm = first(shape, 'xfrm');
      if (xfrm) return xfrm;
      continue;
    }
    if (ph.type === type && (idx === undefined || ph.idx === undefined)) {
      const xfrm = first(shape, 'xfrm');
      if (xfrm) return xfrm;
    }
  }
  return undefined;
};

/** Layout/master xfrm for placeholders that omit a local transform. */
const inheritedXfrm = (
  archive: OpcArchive,
  slidePart: string,
  node: Element,
): Element | undefined => {
  const ph = placeholderOf(node);
  if (!ph) return undefined;
  const layoutPart = archive
    .getRelationships(slidePart)
    .find((rel) => rel.type === REL.layout)?.resolvedTarget;
  if (!layoutPart || !archive.getPart(layoutPart)) return undefined;
  const fromLayout = findPlaceholderXfrm(archive.readXml(layoutPart), ph.type, ph.idx);
  if (fromLayout) return fromLayout;
  const masterPart = archive
    .getRelationships(layoutPart)
    .find((rel) => rel.type === REL.slideMaster)?.resolvedTarget;
  if (!masterPart || !archive.getPart(masterPart)) return undefined;
  return findPlaceholderXfrm(archive.readXml(masterPart), ph.type, ph.idx);
};

const copyXfrmInto = (
  doc: Document,
  seed: Element,
  ns: string,
  qname: string,
): Element => {
  const x = doc.createElementNS(ns, qname);
  for (const name of ['rot', 'flipH', 'flipV'] as const) {
    const value = seed.getAttribute(name);
    if (value != null) x.setAttribute(name, value);
  }
  for (const [local, q] of [
    ['off', 'a:off'],
    ['ext', 'a:ext'],
    ['chOff', 'a:chOff'],
    ['chExt', 'a:chExt'],
  ] as const) {
    const src = directChild(seed, local) ?? first(seed, local);
    if (!src) continue;
    const child = doc.createElementNS(NS.a, q);
    for (const name of ['x', 'y', 'cx', 'cy'] as const) {
      const value = src.getAttribute(name);
      if (value != null) child.setAttribute(name, value);
    }
    x.appendChild(child);
  }
  return x;
};

const ensureSpPrForTransform = (node: Element): Element => {
  const existing = directChild(node, 'spPr');
  if (existing) return existing;
  const doc = node.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  const prefix = node.prefix ? `${node.prefix}:` : 'p:';
  const spPr = doc.createElementNS(NS.p, `${prefix}spPr`);
  const after = children(node).find((child) => child.localName?.startsWith('nv'));
  if (after?.nextSibling) node.insertBefore(spPr, after.nextSibling);
  else if (after) node.appendChild(spPr);
  else if (node.firstChild) node.insertBefore(spPr, node.firstChild);
  else node.appendChild(spPr);
  return spPr;
};

const ensureGrpSpPr = (node: Element): Element => {
  const existing = directChild(node, 'grpSpPr');
  if (existing) return existing;
  const doc = node.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  const prefix = node.prefix ? `${node.prefix}:` : 'p:';
  const grpSpPr = doc.createElementNS(NS.p, `${prefix}grpSpPr`);
  const after = children(node).find((child) => child.localName?.startsWith('nv'));
  if (after?.nextSibling) node.insertBefore(grpSpPr, after.nextSibling);
  else if (after) node.appendChild(grpSpPr);
  else if (node.firstChild) node.insertBefore(grpSpPr, node.firstChild);
  else node.appendChild(grpSpPr);
  return grpSpPr;
};

const ensureXfrm = (
  node: Element,
  archive?: OpcArchive,
  partUri?: string,
): Element => {
  const existing = (() => {
    if (node.localName === 'graphicFrame') return directChild(node, 'xfrm');
    if (node.localName === 'grpSp') {
      const grpSpPr = directChild(node, 'grpSpPr');
      return grpSpPr ? directChild(grpSpPr, 'xfrm') : undefined;
    }
    const spPr = directChild(node, 'spPr');
    return spPr ? directChild(spPr, 'xfrm') : undefined;
  })();
  if (existing) return existing;

  const doc = node.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  const seed =
    archive && partUri ? inheritedXfrm(archive, partUri, node) : undefined;
  const usePresentationXfrm = node.localName === 'graphicFrame';
  const ns = usePresentationXfrm ? NS.p : NS.a;
  const qname = usePresentationXfrm ? 'p:xfrm' : 'a:xfrm';
  const x = seed ? copyXfrmInto(doc, seed, ns, qname) : doc.createElementNS(ns, qname);

  if (node.localName === 'graphicFrame') {
    const after = children(node).find((child) => child.localName?.startsWith('nv'));
    if (after?.nextSibling) node.insertBefore(x, after.nextSibling);
    else if (after) node.appendChild(x);
    else if (node.firstChild) node.insertBefore(x, node.firstChild);
    else node.appendChild(x);
    return x;
  }

  const container =
    node.localName === 'grpSp' ? ensureGrpSpPr(node) : ensureSpPrForTransform(node);
  if (container.firstChild) container.insertBefore(x, container.firstChild);
  else container.appendChild(x);
  return x;
};

const ensureChild = (
  parent: Element,
  localName: string,
  qname: string,
  beforeLocalNames: readonly string[],
): Element => {
  const existing = directChild(parent, localName);
  if (existing) return existing;
  const doc = parent.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  const child = doc.createElementNS(NS.a, qname);
  const before = children(parent).find(
    (item) => item.localName != null && beforeLocalNames.includes(item.localName),
  );
  if (before) parent.insertBefore(child, before);
  else parent.appendChild(child);
  return child;
};

const transform = (
  node: Element,
  t: Record<string, unknown>,
  opts?: { archive?: OpcArchive; partUri?: string },
): void => {
  const x = ensureXfrm(node, opts?.archive, opts?.partUri);
  const needsOff = typeof t['x'] === 'number' || typeof t['y'] === 'number';
  const needsExt = typeof t['width'] === 'number' || typeof t['height'] === 'number';
  const off = needsOff
    ? ensureChild(x, 'off', 'a:off', ['ext', 'chOff', 'chExt'])
    : (directChild(x, 'off') ?? first(x, 'off'));
  const ext = needsExt
    ? ensureChild(x, 'ext', 'a:ext', ['chOff', 'chExt'])
    : (directChild(x, 'ext') ?? first(x, 'ext'));
  if (needsOff && off) {
    if (typeof t['x'] === 'number') off.setAttribute('x', String(Math.round(t['x'])));
    else if (!off.hasAttribute('x')) off.setAttribute('x', '0');
    if (typeof t['y'] === 'number') off.setAttribute('y', String(Math.round(t['y'])));
    else if (!off.hasAttribute('y')) off.setAttribute('y', '0');
  }
  if (needsExt && ext) {
    if (typeof t['width'] === 'number')
      ext.setAttribute('cx', String(Math.round(t['width'])));
    else if (!ext.hasAttribute('cx')) ext.setAttribute('cx', '0');
    if (typeof t['height'] === 'number')
      ext.setAttribute('cy', String(Math.round(t['height'])));
    else if (!ext.hasAttribute('cy')) ext.setAttribute('cy', '0');
  }
  if (typeof t['rotation'] === 'number')
    x.setAttribute('rot', String(Math.round(t['rotation'] * 60000)));
  if (typeof t['flipHorizontal'] === 'boolean' || typeof t['flipX'] === 'boolean') {
    const flip = Boolean(t['flipHorizontal'] ?? t['flipX']);
    if (flip) x.setAttribute('flipH', '1');
    else x.removeAttribute('flipH');
  }
  if (typeof t['flipVertical'] === 'boolean' || typeof t['flipY'] === 'boolean') {
    const flip = Boolean(t['flipVertical'] ?? t['flipY']);
    if (flip) x.setAttribute('flipV', '1');
    else x.removeAttribute('flipV');
  }
};

const indexSlidePartForNotes = (archive: OpcArchive, item: IndexedElement): string | undefined => {
  if (!item.slideId) return undefined;
  const presentation = archive.readXml('/ppt/presentation.xml');
  const rels = archive.getRelationships('/ppt/presentation.xml');
  for (const sld of descendants(presentation, 'sldId')) {
    const id = attr(sld, 'id');
    if (id !== item.slideId) continue;
    const rid = sld.getAttributeNS(NS.r, 'id') ?? attr(sld, 'r:id');
    const rel = rels.find((r) => r.id === rid);
    return rel?.resolvedTarget;
  }
  return undefined;
};

const materializeNotes = (
  archive: OpcArchive,
  item: IndexedElement,
): Result<IndexedElement> => {
  if (item.kind !== 'notes') return ok(item);
  if (item.partUri && archive.getPart(item.partUri)) return ok(item);
  const slidePart =
    typeof item.location?.['slidePart'] === 'string'
      ? item.location['slidePart']
      : indexSlidePartForNotes(archive, item);
  if (!slidePart)
    return err('ELEMENT_NOT_FOUND', `Cannot locate slide for notes ${item.ref.elementId ?? ''}`);
  const partUri = ensureNotes(archive, slidePart);
  return ok({
    ...item,
    partUri,
    ref: { ...item.ref, path: partUri },
    location: { ...item.location, partUri, slidePart, region: 'speakerNotes' },
  });
};

const writeText = (
  archive: OpcArchive,
  item: IndexedElement,
  text: string,
  diagnostics: Diagnostic[],
): Result<void> => {
  const gated = assertWritable(item, archive);
  if (!gated.ok) return gated;
  if (item.kind === 'chart' && typeof item.payload?.['chartPart'] === 'string') {
    const result = updateChart(archive, item.payload['chartPart'], { title: text });
    if (result.workbook)
      diagnostics.push({
        severity: 'warning',
        code: 'EMBEDDED_WORKBOOK_NOT_SYNCHRONIZED',
        message: 'Chart cache changed; embedded workbook was not modified',
      });
    return ok(undefined, diagnostics);
  }
  const notesItem = materializeNotes(archive, item);
  if (!notesItem.ok) return notesItem;
  const target = notesItem.value;
  const doc = archive.readXml(target.partUri),
    node = nodeFor(doc, target);
  if (!node)
    return err(
      'ELEMENT_NOT_FOUND',
      `Element XML node was not found: ${target.ref.elementId ?? target.ref.path ?? ''}`,
    );
  setNodeText(node, text);
  archive.writeXml(target.partUri, doc);
  return ok(undefined, diagnostics);
};

const isDescendantOf = (item: IndexedElement, ancestorId: string): boolean => {
  if (item.parentId === ancestorId) return true;
  const elementId = item.ref.elementId;
  return Boolean(elementId?.startsWith(`${ancestorId}.`));
};

/** Without a selector, skip ancestor elements whose text aggregates descendant matches. */
const narrowReplaceTextCandidates = (candidates: IndexedElement[]): IndexedElement[] => {
  if (candidates.length <= 1) return candidates;
  return candidates.filter((item) => {
    const id = item.ref.elementId;
    if (!id) return true;
    return !candidates.some((other) => other.ref.elementId !== id && isDescendantOf(other, id));
  });
};

const applyReplaceText = (
  command: Extract<AtomicCommand, { type: 'replaceText' }>,
  archive: OpcArchive,
  index: IndexFile,
): Result<MutationOutcome> => {
  if (command.regex) {
    try {
      new RegExp(command.find, 'u');
    } catch (cause) {
      return err(
        'INVALID_COMMAND',
        cause instanceof Error ? cause.message : 'Invalid replaceText regex',
      );
    }
  }
  const matches = (text: string): boolean =>
    command.regex ? new RegExp(command.find, 'u').test(text) : text.includes(command.find);
  const replaced = (text: string): string =>
    command.regex
      ? text.replace(new RegExp(command.find, 'gu'), command.replace)
      : text.split(command.find).join(command.replace);
  let candidates = index.elements.filter(
    (item) =>
      Boolean(item.text?.length) &&
      (!command.selector || matchesSelector(item, command.selector)) &&
      matches(item.text ?? ''),
  );
  if (!command.selector) candidates = narrowReplaceTextCandidates(candidates);
  const limit = command.limit ?? 1000;
  const selected = candidates.slice(0, limit);
  const diagnostics: Diagnostic[] = [];
  const refs: ElementRef[] = [];
  const slidePages: number[] = [];
  for (const item of selected) {
    const next = replaced(item.text ?? '');
    if (next === item.text) continue;
    const written = writeText(archive, item, next, diagnostics);
    if (!written.ok) return written;
    refs.push(item.ref);
    slidePages.push(...slidesForItem(index, item));
  }
  return ok(
    {
      changed: refs.length > 0,
      matched: refs.length,
      refs,
      slides: mergeSlides(slidePages),
      diagnostics,
    },
    diagnostics,
  );
};

const resolveCommandRef = (
  command: AtomicCommand,
  index: IndexFile,
): Result<{ ref: ElementRef; item: IndexedElement; target?: string }> => {
  if (command.type === 'replaceText')
    return err('INVALID_COMMAND', 'replaceText does not resolve a single ref');
  if (command.type === 'addSlide' || command.type === 'addShape')
    return err('INVALID_COMMAND', 'addSlide/addShape resolve separately');
  if (command.type === 'xfrmSet') {
    const target =
      command.target ??
      (command.slide !== undefined && command.shape !== undefined
        ? `slide:${command.slide}/shape:${command.shape}`
        : undefined);
    if (!target) return err('INVALID_COMMAND', 'xfrmSet requires target or slide+shape');
    const resolved = resolveTarget(index, target);
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      value: {
        ref: resolved.value.item.ref,
        item: resolved.value.item,
        target: resolved.value.target,
      },
      diagnostics: [],
    };
  }
  if (command.type === 'zMove' || command.type === 'set') {
    const resolved = resolveTarget(index, command.target);
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      value: {
        ref: resolved.value.item.ref,
        item: resolved.value.item,
        target: resolved.value.target,
      },
      diagnostics: [],
    };
  }
  if (command.type === 'add') {
    const got = resolveToRef(index, {
      ...(command.parent !== undefined ? { ref: command.parent } : {}),
      ...(command.target !== undefined ? { target: command.target } : {}),
    });
    if (!got.ok) return got;
    const item = got.value.resolved?.item ?? findIndexed(index, got.value.ref);
    if (!item) return err('ELEMENT_NOT_FOUND', 'Element reference was not found');
    return {
      ok: true,
      value: {
        ref: item.ref,
        item,
        ...(got.value.resolved?.target !== undefined
          ? { target: got.value.resolved.target }
          : {}),
      },
      diagnostics: [],
    };
  }
  const got = resolveToRef(index, {
    ...('ref' in command && command.ref !== undefined ? { ref: command.ref } : {}),
    ...('target' in command && command.target !== undefined ? { target: command.target } : {}),
  });
  if (!got.ok) return got;
  // Prefer the item from target resolution so synthetic notes (not yet in the index) work.
  const item = got.value.resolved?.item ?? findIndexed(index, got.value.ref);
  if (!item) return err('ELEMENT_NOT_FOUND', 'Element reference was not found');
  return {
    ok: true,
    value: {
      ref: item.ref,
      item,
      ...(got.value.resolved?.target !== undefined ? { target: got.value.resolved.target } : {}),
    },
    diagnostics: [],
  };
};

const shapeTypeToElement = (
  shapeType: Extract<AtomicCommand, { type: 'addShape' }>['shapeType'],
  fields: Record<string, unknown>,
): Record<string, unknown> => {
  const base = { ...fields };
  switch (shapeType) {
    case 'text':
      return {
        ...base,
        kind: 'textbox',
        type: 'textbox',
        preset: 'rect',
        text: typeof fields['text'] === 'string' ? fields['text'] : '',
      };
    case 'rect':
      return { ...base, kind: 'shape', type: 'shape', preset: 'rect' };
    case 'rounded-rect':
      return { ...base, kind: 'shape', type: 'shape', preset: 'roundRect' };
    case 'ellipse':
      return { ...base, kind: 'shape', type: 'shape', preset: 'ellipse' };
    case 'line':
      return { ...base, kind: 'connector', type: 'connector' };
    case 'image':
      return {
        ...base,
        kind: 'picture',
        type: 'picture',
        ...(typeof fields['file'] === 'string' ? { path: fields['file'] } : {}),
      };
    case 'group':
      return { ...base, kind: 'group', type: 'group' };
    case 'table':
      return {
        ...base,
        kind: 'table',
        type: 'table',
        rows: Array.isArray(fields['rows']) ? fields['rows'] : [['']],
      };
    case 'chart':
      return {
        ...base,
        kind: 'chart',
        type: 'chart',
        ...(typeof fields['chartType'] === 'string' ? { chartType: fields['chartType'] } : {}),
        ...(fields['data'] !== undefined ? { data: fields['data'] } : {}),
      };
    case 'video':
      return {
        ...base,
        kind: 'video',
        type: 'video',
        ...(typeof fields['file'] === 'string' ? { path: fields['file'] } : {}),
      };
    case 'audio':
      return {
        ...base,
        kind: 'audio',
        type: 'audio',
        ...(typeof fields['file'] === 'string' ? { path: fields['file'] } : {}),
      };
  }
};

const applyZMove = (
  doc: Document,
  node: Element,
  command: Extract<AtomicCommand, { type: 'zMove' }>,
  index: IndexFile,
): Result<void> => {
  const parent = node.parentNode as Element | null;
  if (!parent) return err('INVALID_COMMAND', 'Shape has no parent for z-order move');
  const siblings = children(parent).filter(
    (child) => child.localName != null && SHAPE_LOCAL_NAMES.has(child.localName),
  );
  if (!siblings.includes(node))
    return err('INVALID_COMMAND', 'Shape is not a direct child of the shape tree');

  const findSibling = (target: string): Result<Element> => {
    const resolved = resolveTarget(index, target);
    if (!resolved.ok) return resolved;
    const other = nodeFor(doc, resolved.value.item);
    if (!other || !siblings.includes(other))
      return err('TARGET_NOT_FOUND', `z-order reference not on same parent: ${target}`, [], {
        target,
      });
    return { ok: true, value: other, diagnostics: [] };
  };

  parent.removeChild(node);
  if (command.toFront) {
    parent.appendChild(node);
    return ok(undefined);
  }
  if (command.toBack) {
    const firstShape = children(parent).find(
      (child) => child.localName != null && SHAPE_LOCAL_NAMES.has(child.localName),
    );
    if (firstShape) parent.insertBefore(node, firstShape);
    else parent.appendChild(node);
    return ok(undefined);
  }
  if (command.above) {
    const other = findSibling(command.above);
    if (!other.ok) return other;
    if (other.value.nextSibling) parent.insertBefore(node, other.value.nextSibling);
    else parent.appendChild(node);
    return ok(undefined);
  }
  if (command.below) {
    const other = findSibling(command.below);
    if (!other.ok) return other;
    parent.insertBefore(node, other.value);
    return ok(undefined);
  }
  return err('INVALID_COMMAND', 'zMove requires --above, --below, --to-front, or --to-back');
};

export async function mutate(
  command: AtomicCommand,
  archive: OpcArchive,
  index: IndexFile,
): Promise<Result<MutationOutcome & { changedTargets?: string[]; changedParts?: string[] }>> {
  if (command.type === 'replaceText') return applyReplaceText(command, archive, index);

  if (command.type === 'addSlide') {
    const slides = index.elements.filter((item) => item.kind === 'slide');
    let layout: string | undefined;
    if (command.layout) {
      const layouts = index.elements.filter((item) => item.kind === 'layout');
      const needle = command.layout.toLowerCase();
      const layoutDisplayName = (partUri: string): string => {
        try {
          const cSld = first(archive.readXml(partUri), 'cSld');
          return (attr(cSld, 'name') ?? '').toLowerCase();
        } catch {
          return '';
        }
      };
      const match = layouts.find((item) => {
        const fileName = item.partUri.split('/').pop()?.replace(/\.xml$/, '') ?? '';
        const display = layoutDisplayName(item.partUri);
        // Match by cSld@name (e.g. "Blank") or part basename — never treat
        // needle==="blank" as matching every layout (that picked Title Slide).
        return (
          display === needle ||
          fileName.toLowerCase() === needle ||
          (needle !== 'blank' &&
            (display.includes(needle) || fileName.toLowerCase().includes(needle)))
        );
      });
      if (!match && needle !== 'blank')
        return err('TARGET_NOT_FOUND', `Layout not found: ${command.layout}`);
      layout = match?.partUri;
    }
    // Prefer an explicit layout; otherwise inherit the layout of the anchor slide
    // (or the first slide) so blank pages still bind to a slideLayout.
    if (!layout) {
      const anchor =
        command.after !== undefined && command.after > 0
          ? slides[command.after - 1]
          : slides[0];
      if (anchor) {
        const rels = archive.getRelationships(anchor.partUri);
        const layoutRel = rels.find((r) => r.type === REL.layout);
        layout = layoutRel?.resolvedTarget;
      }
    }
    const partUri = addSlide(archive, undefined, layout, command.after);
    return ok({
      changed: true,
      partUri,
      slides: [],
      changedParts: [partUri, '/ppt/presentation.xml'],
    });
  }

  if (command.type === 'addShape') {
    const slides = index.elements.filter((item) => item.kind === 'slide');
    const slide = slides[command.slide - 1];
    if (!slide)
      return err('TARGET_NOT_FOUND', `slide:${command.slide} does not exist`, [], {
        target: `slide:${command.slide}`,
      });
    let role: string | undefined;
    if (command.role !== undefined) {
      const normalized = normalizePlaceholderRole(command.role);
      if (!normalized.ok) return err('INVALID_COMMAND', normalized.message);
      role = normalized.type;
    }
    const doc = archive.readXml(slide.partUri);
    const parent = first(doc, 'spTree') ?? root(doc);
    const geom = normalizeTransformFields(archive, {
      ...(command.x !== undefined ? { x: command.x } : {}),
      ...(command.y !== undefined ? { y: command.y } : {}),
      ...(command.width !== undefined ? { width: command.width } : {}),
      ...(command.height !== undefined ? { height: command.height } : {}),
    });
    const element = shapeTypeToElement(command.shapeType, {
      ...(command.name !== undefined ? { name: command.name } : {}),
      ...(role !== undefined ? { role } : {}),
      ...geom,
      ...(command.file !== undefined ? { file: command.file } : {}),
      ...(command.text !== undefined ? { text: command.text } : {}),
      ...(command.rows !== undefined ? { rows: command.rows } : {}),
      ...(command.theme !== undefined ? { theme: command.theme } : {}),
      ...(command.alignColumns !== undefined ? { alignColumns: command.alignColumns } : {}),
      ...(command.chartType !== undefined ? { chartType: command.chartType } : {}),
      ...(command.data !== undefined ? { data: command.data } : {}),
      ...(command.showDataLabels !== undefined
        ? { showDataLabels: command.showDataLabels }
        : {}),
    });
    const created = await addElement(archive, slide.partUri, doc, parent, element);
    archive.writeXml(slide.partUri, doc);
    const id = attr(cNvPr(created), 'id') ?? '?';
    return ok({
      changed: true,
      slides: [command.slide],
      changedTargets: [`slide:${command.slide}/shape:${id}`],
      changedParts: [slide.partUri],
    });
  }

  if (command.type === 'alignElements') {
    const slides = index.elements.filter((item) => item.kind === 'slide');
    const slide = slides[command.slide - 1];
    if (!slide)
      return err('TARGET_NOT_FOUND', `slide:${command.slide} does not exist`, [], {
        target: `slide:${command.slide}`,
      });
    const doc = archive.readXml(slide.partUri);
    const boxes = [];
    for (const target of command.targets) {
      const resolved = resolveTarget(index, target);
      if (!resolved.ok) return resolved;
      const node = nodeFor(doc, resolved.value.item);
      if (!node)
        return err('ELEMENT_NOT_FOUND', `Element XML node was not found: ${target}`, [], {
          target,
        });
      const box = readBBox(node);
      if (!box)
        return err('INVALID_COMMAND', `Target has no geometry (xfrm): ${target}`, [], { target });
      boxes.push(box);
    }
    const updates = computeAlignUpdates(
      boxes,
      command.mode,
      command.gap,
      lengthContextFor(archive, command.mode.includes('v') ? 'y' : 'x'),
    );
    for (const update of updates) writeBBox(update.node, update);
    archive.writeXml(slide.partUri, doc);
    return ok({
      changed: true,
      slides: [command.slide],
      changedTargets: [...command.targets],
      changedParts: [slide.partUri],
    });
  }

  const resolved = resolveCommandRef(command, index);
  if (!resolved.ok) return resolved;
  const { item, target } = resolved.value;
  if (item.ref.revision && item.ref.revision !== index.revision)
    return err(
      'TRANSACTION_CONFLICT',
      `Expected revision ${item.ref.revision}, current ${index.revision}`,
    );

  // Edition capability gate (master/layout/theme/advanced chart writes).
  // Slide add/remove/duplicate and addSlide layout binding are not gated here.
  if (item.kind !== 'slide') {
    const gated = assertWritable(item, archive);
    if (!gated.ok) return gated;
  }

  const diagnostics: Diagnostic[] = [];
  if (item.kind === 'slide') {
    if (command.type === 'remove') {
      removeSlide(archive, item.partUri);
      return ok({
        changed: true,
        slides: slidesForItem(index, item),
        ...(target ? { changedTargets: [target] } : {}),
        changedParts: ['/ppt/presentation.xml'],
      });
    }
    if (command.type === 'duplicate') {
      return ok({
        changed: true,
        partUri: duplicateSlide(archive, item.partUri),
        slides: slidesForItem(index, item),
      });
    }
    if (command.type === 'add') {
      const rawKind = command.element['kind'] ?? command.element['type'];
      if (rawKind === 'slide') {
        const template =
            typeof command.element['templatePart'] === 'string'
              ? command.element['templatePart']
              : undefined,
          layout =
            typeof command.element['layoutPart'] === 'string'
              ? command.element['layoutPart']
              : undefined;
        return ok({ changed: true, partUri: addSlide(archive, template, layout), slides: [] });
      }
    }
    if (command.type === 'set' || command.type === 'setProperties') {
      // slide-level name/hidden not fully modeled; treat as unsupported for now except no-op properties
      return err(
        'UNSUPPORTED_CAPABILITY',
        'Slide property writes beyond add/remove are limited in Phase 1a',
        [],
        target !== undefined ? { target } : {},
      );
    }
  }

  const notesReady = materializeNotes(archive, item);
  if (!notesReady.ok) return notesReady;
  const liveItem = notesReady.value;

  const doc = archive.readXml(liveItem.partUri),
    node = nodeFor(doc, liveItem);
  if (!node)
    return err(
      'ELEMENT_NOT_FOUND',
      `Element XML node was not found: ${liveItem.ref.elementId ?? liveItem.ref.path ?? ''}`,
    );

  const chartPart =
    liveItem.kind === 'chart' && typeof liveItem.payload?.['chartPart'] === 'string'
      ? liveItem.payload['chartPart']
      : undefined;
  let chartMutated = false;

  if (command.type === 'setText') {
    if (command.blocks !== undefined) {
      if (chartPart)
        return err('INVALID_COMMAND', 'Chart titles do not support rich text blocks');
      setNodeTextBlocks(
        node,
        command.blocks.map((block) => {
          const styled: {
            text: string;
            fontSize?: number;
            fontFamily?: string;
            textColor?: string;
            bold?: boolean;
            italic?: boolean;
            underline?: boolean;
            align?: string;
          } = { text: block.text };
          if (block.fontSize !== undefined) styled.fontSize = block.fontSize;
          if (block.fontFamily !== undefined) styled.fontFamily = block.fontFamily;
          if (block.textColor !== undefined) styled.textColor = block.textColor;
          if (block.bold !== undefined) styled.bold = block.bold;
          if (block.italic !== undefined) styled.italic = block.italic;
          if (block.underline !== undefined) styled.underline = block.underline;
          if (block.align !== undefined) styled.align = block.align;
          return styled;
        }),
      );
    } else {
      const text = command.text ?? command.value;
      if (text === undefined) return err('INVALID_COMMAND', 'setText requires text, value, or blocks');
      if (chartPart) {
        const result = updateChart(archive, chartPart, { title: text });
        chartMutated = true;
        if (result.workbook)
          diagnostics.push({
            severity: 'warning',
            code: 'EMBEDDED_WORKBOOK_NOT_SYNCHRONIZED',
            message: 'Chart cache changed; embedded workbook was not modified',
          });
      } else setNodeText(node, text);
    }
  } else if (command.type === 'setTransform') {
    transform(node, normalizeTransformFields(archive, command.transform as Record<string, unknown>), {
      archive,
      partUri: liveItem.partUri,
    });
  } else if (command.type === 'xfrmSet') {
    const geom = normalizeTransformFields(archive, {
      ...(command.x !== undefined ? { x: command.x } : {}),
      ...(command.y !== undefined ? { y: command.y } : {}),
      ...(command.width !== undefined ? { width: command.width } : {}),
      ...(command.height !== undefined ? { height: command.height } : {}),
    });
    transform(
      node,
      {
        ...geom,
        ...(command.rotation !== undefined ? { rotation: command.rotation } : {}),
        ...(command.flipX !== undefined ? { flipX: command.flipX } : {}),
        ...(command.flipY !== undefined ? { flipY: command.flipY } : {}),
      },
      { archive, partUri: liveItem.partUri },
    );
  } else if (command.type === 'set' || command.type === 'setProperties') {
    if (command.type === 'set' && command.scope && command.scope !== 'local')
      return err(
        'UNSUPPORTED_CAPABILITY',
        `Write scope "${command.scope}" is not enabled in Phase 1a; use --scope local`,
        [],
        target !== undefined ? { target } : {},
      );
    const properties =
      command.type === 'set' ? mapDottedProperties(command.properties) : command.properties;
    if (chartPart) {
      const checked = assertChartProperties(properties);
      if (!checked.ok) return checked;
      const chartProps = { ...properties };
      if (typeof chartProps['text'] === 'string' && chartProps['title'] === undefined)
        chartProps['title'] = chartProps['text'];
      const result = updateChart(archive, chartPart, chartProps);
      chartMutated = true;
      if (result.workbook)
        diagnostics.push({
          severity: 'warning',
          code: 'EMBEDDED_WORKBOOK_NOT_SYNCHRONIZED',
          message: 'Chart cache changed; embedded workbook was not modified',
        });
    } else if (liveItem.kind === 'table') {
      const applied = applyTableProperties(node, properties, {
        archive,
        partUri: liveItem.partUri,
      });
      if (!applied.ok) return applied;
      if (applied.value.applied.length === 0)
        return err('INVALID_COMMAND', 'set requires at least one supported property');
    } else if (liveItem.kind === 'tableCell') {
      const applied = applyTableCellProperties(node, properties);
      if (!applied.ok) return applied;
      if (applied.value.applied.length === 0)
        return err('INVALID_COMMAND', 'set requires at least one supported property');
    } else {
      const applied = applyShapeProperties(node, properties, {
        archive,
        partUri: liveItem.partUri,
      });
      if (!applied.ok) return applied;
      if (applied.value.applied.length === 0)
        return err('INVALID_COMMAND', 'set requires at least one supported property');
    }
  } else if (command.type === 'zMove') {
    const moved = applyZMove(doc, node, command, index);
    if (!moved.ok) return moved;
  } else if (command.type === 'replacePicture') {
    if (liveItem.kind !== 'picture')
      return err('INVALID_COMMAND', 'replacePicture requires a picture element');
    const loaded = await loadPictureBytes({
      ...(command.path !== undefined ? { path: command.path } : {}),
      ...(command.base64 !== undefined ? { base64: command.base64 } : {}),
    });
    if (!loaded.ok) return loaded;
    const replaced = replacePictureMedia(
      archive,
      liveItem.partUri,
      node,
      loaded.value.data,
      loaded.value.ext,
    );
    if (!replaced.ok) return replaced;
  } else if (command.type === 'remove') {
    if (liveItem.kind === 'picture') detachPictureAndCleanup(archive, liveItem.partUri, doc, node);
    else if (liveItem.kind === 'video' || liveItem.kind === 'audio')
      detachMediaAndCleanup(archive, liveItem.partUri, doc, node);
    else node.parentNode?.removeChild(node);
  } else if (command.type === 'duplicate') duplicateElement(doc, node);
  else if (command.type === 'add') {
    const parent = liveItem.kind === 'slide' ? (first(doc, 'spTree') ?? node) : node;
    await addElement(archive, liveItem.partUri, doc, parent, command.element);
  } else {
    return err('INVALID_COMMAND', `Unhandled mutation type`);
  }

  archive.writeXml(liveItem.partUri, doc);
  const changedParts = [liveItem.partUri];
  if (chartMutated && chartPart) changedParts.push(chartPart);
  if (liveItem.kind === 'notes' && typeof liveItem.location?.['slidePart'] === 'string')
    changedParts.push(liveItem.location['slidePart']);
  return ok(
    {
      changed: true,
      slides: slidesForItem(index, liveItem),
      diagnostics,
      ...(target ? { changedTargets: [target] } : {}),
      changedParts,
    },
    diagnostics,
  );
}
