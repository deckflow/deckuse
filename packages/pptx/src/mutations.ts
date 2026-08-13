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
import { addElement, duplicateElement, updateChart } from './elements.js';
import { findIndexed, matchesSelector } from './indexer.js';
import { detachPictureAndCleanup, loadPictureBytes, replacePictureMedia } from './picture.js';
import { applyShapeProperties, assertChartProperties } from './properties.js';
import { addSlide, duplicateSlide, removeSlide } from './slides.js';
import type { IndexFile, IndexedElement, MutationOutcome } from './types.js';
import { attr, cNvPr, descendants, first, root, setNodeText } from './xml.js';
const nodeFor = (doc: Document, item: IndexedElement): Element | undefined => {
  if (['slide', 'notes', 'master', 'layout', 'theme'].includes(item.kind)) return root(doc);
  if (item.kind === 'tableCell') {
    const rawTableId = item.location?.['tableId'],
      tableId = typeof rawTableId === 'string' ? rawTableId : '',
      tableTail = tableId.split('.').at(-1),
      table = descendants(doc).find((n) => attr(cNvPr(n), 'id') === tableTail);
    if (!table) return;
    const row = descendants(table, 'tr')[Number(item.location?.['row'])];
    return row ? descendants(row, 'tc')[Number(item.location?.['column'])] : undefined;
  }
  // elementId is `${slideId}:${ancestors.cNvPrId joined by .}`; cNvPr ids are the leaf only.
  const raw = item.location?.['cNvPrId'];
  const tail =
    typeof raw === 'string'
      ? raw
      : item.ref.elementId?.includes(':')
        ? item.ref.elementId.split(':').slice(1).join(':').split('.').at(-1)
        : item.ref.elementId?.split('.').at(-1);
  return descendants(doc).find((n) => attr(cNvPr(n), 'id') === tail);
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
  const candidates = index.elements.filter(
    (item) =>
      Boolean(item.text?.length) &&
      (!command.selector || matchesSelector(item, command.selector)) &&
      matches(item.text ?? ''),
  );
  const limit = command.limit ?? 1000;
  const selected = candidates.slice(0, limit);
  const diagnostics: Diagnostic[] = [];
  const refs: ElementRef[] = [];
  for (const item of selected) {
    const next = replaced(item.text ?? '');
    if (next === item.text) continue;
    const written = writeText(archive, item, next, diagnostics);
    if (!written.ok) return written;
    refs.push(item.ref);
  }
  return ok({ changed: refs.length > 0, matched: refs.length, refs, diagnostics }, diagnostics);
};
export async function mutate(
  command: AtomicCommand,
  archive: OpcArchive,
  index: IndexFile,
): Promise<Result<MutationOutcome>> {
  if (command.type === 'replaceText') return applyReplaceText(command, archive, index);
  const ref = command.type === 'add' ? command.parent : command.ref;
  if (ref.revision && ref.revision !== index.revision)
    return err(
      'TRANSACTION_CONFLICT',
      `Expected revision ${ref.revision}, current ${index.revision}`,
    );
  const item = findIndexed(index, ref);
  if (!item) return err('ELEMENT_NOT_FOUND', 'Element reference was not found');
  const diagnostics: Diagnostic[] = [];
  if (item.kind === 'slide') {
    if (command.type === 'remove') {
      removeSlide(archive, item.partUri);
      return ok({ changed: true });
    }
    if (command.type === 'duplicate') {
      return ok({
        changed: true,
        partUri: duplicateSlide(archive, item.partUri),
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
        return ok({ changed: true, partUri: addSlide(archive, template, layout) });
      }
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
    if (item.kind === 'chart' && typeof item.payload?.['chartPart'] === 'string') {
      const result = updateChart(archive, item.payload['chartPart'], { title: command.text });
      if (result.workbook)
        diagnostics.push({
          severity: 'warning',
          code: 'EMBEDDED_WORKBOOK_NOT_SYNCHRONIZED',
          message: 'Chart cache changed; embedded workbook was not modified',
        });
    } else setNodeText(node, command.text);
  } else if (command.type === 'setTransform') transform(node, command.transform);
  else if (command.type === 'setProperties') {
    if (item.kind === 'chart' && typeof item.payload?.['chartPart'] === 'string') {
      const checked = assertChartProperties(command.properties);
      if (!checked.ok) return checked;
      const chartProps = { ...command.properties };
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
      const applied = applyShapeProperties(node, command.properties);
      if (!applied.ok) return applied;
      if (applied.value.applied.length === 0)
        return err('INVALID_COMMAND', 'setProperties requires at least one supported property');
    }
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
  else {
    const parent = item.kind === 'slide' ? (first(doc, 'spTree') ?? node) : node;
    await addElement(archive, item.partUri, doc, parent, command.element);
  }
  archive.writeXml(item.partUri, doc, archive.getPart(item.partUri)?.mediaType);
  return ok({ changed: true, diagnostics }, diagnostics);
}
