import {
  err,
  ok,
  type AtomicCommand,
  type Diagnostic,
  type ElementRef,
  type Result,
} from '@deckflow/deckuse-core';
import type { OpcArchive } from '@deckflow/deckuse-opc';
import type { Document, Element } from '@xmldom/xmldom';
import { resolveTarget, resolveToRef, cNvPrIdOf } from './addressing.js';
import { addElement, duplicateElement, updateChart } from './elements.js';
import { findIndexed, matchesSelector, mergeSlides, slidesForItem, slidePageMap } from './indexer.js';
import { detachPictureAndCleanup, loadPictureBytes, replacePictureMedia } from './picture.js';
import { applyShapeProperties, assertChartProperties } from './properties.js';
import { mapDottedProperties } from './resolve-properties.js';
import { addSlide, duplicateSlide, removeSlide } from './slides.js';
import type { IndexFile, IndexedElement, MutationOutcome } from './types.js';
import { attr, children, cNvPr, descendants, first, root, setNodeText } from './xml.js';

const SHAPE_LOCAL_NAMES = new Set(['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp']);
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
      tableId = typeof rawTableId === 'string' ? rawTableId : '',
      tableTail = tableId.split('.').at(-1) ?? '';
    if (!tableTail) return undefined;
    const table = shapeByCNvPrId(doc, tableTail);
    if (!table) return;
    const row = descendants(table, 'tr')[Number(item.location?.['row'])];
    return row ? descendants(row, 'tc')[Number(item.location?.['column'])] : undefined;
  }
  const id = cNvPrIdOf(item);
  return id ? shapeByCNvPrId(doc, id) : undefined;
};

const transform = (node: Element, t: Record<string, unknown>): void => {
  const x = first(node, 'xfrm');
  if (!x) throw new Error('Element has no transform');
  const doc = node.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  let off = first(x, 'off');
  if (!off) {
    off = doc.createElementNS(x.namespaceURI, 'a:off');
    x.appendChild(off);
  }
  let ext = first(x, 'ext');
  if (!ext) {
    ext = doc.createElementNS(x.namespaceURI, 'a:ext');
    x.appendChild(ext);
  }
  for (const [element, key, input, scale] of [
    [off, 'x', 'x', 1],
    [off, 'y', 'y', 1],
    [ext, 'cx', 'width', 1],
    [ext, 'cy', 'height', 1],
    [x, 'rot', 'rotation', 60000],
  ] as const)
    if (typeof t[input] === 'number')
      element.setAttribute(key, String(Math.round(t[input] * scale)));
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

const writeText = (
  archive: OpcArchive,
  item: IndexedElement,
  text: string,
  diagnostics: Diagnostic[],
): Result<void> => {
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
  const doc = archive.readXml(item.partUri),
    node = nodeFor(doc, item);
  if (!node)
    return err(
      'ELEMENT_NOT_FOUND',
      `Element XML node was not found: ${item.ref.elementId ?? item.ref.path ?? ''}`,
    );
  setNodeText(node, text);
  archive.writeXml(item.partUri, doc, archive.getPart(item.partUri)?.mediaType);
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
    const item = findIndexed(index, got.value.ref);
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
  const item = findIndexed(index, got.value.ref);
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
      return { ...base, kind: 'textbox', type: 'textbox', preset: 'rect' };
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
    const pages = slidePageMap(index);
    const slides = index.elements.filter((item) => item.kind === 'slide');
    let template: string | undefined;
    let layout: string | undefined;
    if (command.layout) {
      const layouts = index.elements.filter((item) => item.kind === 'layout');
      const needle = command.layout.toLowerCase();
      const match = layouts.find((item) => {
        const name = item.partUri.split('/').pop()?.replace(/\.xml$/, '') ?? '';
        return (
          name.toLowerCase() === needle ||
          name.toLowerCase().includes(needle) ||
          needle === 'blank'
        );
      });
      if (command.layout !== 'blank' && !match && needle !== 'blank')
        return err('TARGET_NOT_FOUND', `Layout not found: ${command.layout}`);
      layout = match?.partUri;
    }
    if (command.after !== undefined && command.after > 0) {
      const afterSlide = slides[command.after - 1];
      template = afterSlide?.partUri;
    }
    // blank layout: add empty slide without cloning content
    const partUri =
      command.layout === 'blank' || !template
        ? addSlide(archive, undefined, layout)
        : addSlide(archive, undefined, layout);
    void pages;
    void template;
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
    const doc = archive.readXml(slide.partUri);
    const parent = first(doc, 'spTree') ?? root(doc);
    const element = shapeTypeToElement(command.shapeType, {
      ...(command.name !== undefined ? { name: command.name } : {}),
      ...(command.role !== undefined ? { role: command.role } : {}),
      ...(command.x !== undefined ? { x: command.x } : {}),
      ...(command.y !== undefined ? { y: command.y } : {}),
      ...(command.width !== undefined ? { width: command.width } : {}),
      ...(command.height !== undefined ? { height: command.height } : {}),
      ...(command.file !== undefined ? { file: command.file } : {}),
    });
    const created = await addElement(archive, slide.partUri, doc, parent, element);
    archive.writeXml(slide.partUri, doc, archive.getPart(slide.partUri)?.mediaType);
    const id = attr(cNvPr(created), 'id') ?? '?';
    return ok({
      changed: true,
      slides: [command.slide],
      changedTargets: [`slide:${command.slide}/shape:${id}`],
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

  const doc = archive.readXml(item.partUri),
    node = nodeFor(doc, item);
  if (!node)
    return err(
      'ELEMENT_NOT_FOUND',
      `Element XML node was not found: ${item.ref.elementId ?? item.ref.path ?? ''}`,
    );

  if (command.type === 'setText') {
    const text = command.text ?? command.value;
    if (text === undefined) return err('INVALID_COMMAND', 'setText requires text or value');
    if (item.kind === 'chart' && typeof item.payload?.['chartPart'] === 'string') {
      const result = updateChart(archive, item.payload['chartPart'], { title: text });
      if (result.workbook)
        diagnostics.push({
          severity: 'warning',
          code: 'EMBEDDED_WORKBOOK_NOT_SYNCHRONIZED',
          message: 'Chart cache changed; embedded workbook was not modified',
        });
    } else setNodeText(node, text);
  } else if (command.type === 'setTransform') transform(node, command.transform);
  else if (command.type === 'xfrmSet') {
    transform(node, {
      ...(command.x !== undefined ? { x: command.x } : {}),
      ...(command.y !== undefined ? { y: command.y } : {}),
      ...(command.width !== undefined ? { width: command.width } : {}),
      ...(command.height !== undefined ? { height: command.height } : {}),
      ...(command.rotation !== undefined ? { rotation: command.rotation } : {}),
      ...(command.flipX !== undefined ? { flipX: command.flipX } : {}),
      ...(command.flipY !== undefined ? { flipY: command.flipY } : {}),
    });
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
    if (item.kind === 'chart' && typeof item.payload?.['chartPart'] === 'string') {
      const checked = assertChartProperties(properties);
      if (!checked.ok) return checked;
      const chartProps = { ...properties };
      if (typeof chartProps['text'] === 'string' && chartProps['title'] === undefined)
        chartProps['title'] = chartProps['text'];
      const result = updateChart(archive, item.payload['chartPart'], chartProps);
      if (result.workbook)
        diagnostics.push({
          severity: 'warning',
          code: 'EMBEDDED_WORKBOOK_NOT_SYNCHRONIZED',
          message: 'Chart cache changed; embedded workbook was not modified',
        });
    } else {
      const applied = applyShapeProperties(node, properties);
      if (!applied.ok) return applied;
      if (applied.value.applied.length === 0)
        return err('INVALID_COMMAND', 'set requires at least one supported property');
    }
  } else if (command.type === 'zMove') {
    const moved = applyZMove(doc, node, command, index);
    if (!moved.ok) return moved;
  } else if (command.type === 'replacePicture') {
    if (item.kind !== 'picture')
      return err('INVALID_COMMAND', 'replacePicture requires a picture element');
    const loaded = await loadPictureBytes({
      ...(command.path !== undefined ? { path: command.path } : {}),
      ...(command.base64 !== undefined ? { base64: command.base64 } : {}),
    });
    if (!loaded.ok) return loaded;
    const replaced = replacePictureMedia(
      archive,
      item.partUri,
      node,
      loaded.value.data,
      loaded.value.ext,
    );
    if (!replaced.ok) return replaced;
  } else if (command.type === 'remove') {
    if (item.kind === 'picture') detachPictureAndCleanup(archive, item.partUri, doc, node);
    else node.parentNode?.removeChild(node);
  } else if (command.type === 'duplicate') duplicateElement(doc, node);
  else if (command.type === 'add') {
    const parent = item.kind === 'slide' ? (first(doc, 'spTree') ?? node) : node;
    await addElement(archive, item.partUri, doc, parent, command.element);
  } else {
    return err('INVALID_COMMAND', `Unhandled mutation type`);
  }

  archive.writeXml(item.partUri, doc, archive.getPart(item.partUri)?.mediaType);
  return ok(
    {
      changed: true,
      slides: slidesForItem(index, item),
      diagnostics,
      ...(target ? { changedTargets: [target] } : {}),
      changedParts: [item.partUri],
    },
    diagnostics,
  );
}
