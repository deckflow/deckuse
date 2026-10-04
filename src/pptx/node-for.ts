import type { Document, Element } from '@xmldom/xmldom';
import { err, ok, type Result } from '../core/index.js';
import { cNvPrIdOf, type ParsedTarget } from './addressing.js';
import type { IndexedElement } from './types.js';
import { attr, children, cNvPr, descendants, first, notesBodyShape, root } from './xml.js';

const SHAPE_LOCAL_NAMES = new Set(['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp']);

export const shapeByCNvPrId = (doc: Document, id: string): Element | undefined =>
  descendants(doc).find(
    (node) =>
      node.localName != null &&
      SHAPE_LOCAL_NAMES.has(node.localName) &&
      attr(cNvPr(node), 'id') === id,
  );

const directChildren = (node: Element, localName: string): Element[] =>
  children(node).filter((c) => c.localName === localName);

/**
 * Locate the XML node for an indexed element. Table cells use tableId/row/column
 * with the same direct-child tr/tc walk as the indexer (not recursive descendants).
 */
export const nodeFor = (doc: Document, item: IndexedElement): Element | undefined => {
  if (item.kind === 'notes') return notesBodyShape(doc) ?? undefined;
  if (['slide', 'master', 'layout', 'theme'].includes(item.kind)) return root(doc);
  if (item.kind === 'tableCell') {
    const rawTableId = item.location?.['tableId'];
    const tableId = typeof rawTableId === 'string' ? rawTableId : '';
    // elementId is `${slideId}:${ancestorPath}` — strip the slide prefix, then the leaf cNvPr id.
    const afterSlide = tableId.includes(':') ? tableId.slice(tableId.indexOf(':') + 1) : tableId;
    const tableTail = afterSlide.split('.').at(-1) ?? afterSlide;
    if (!tableTail) return undefined;
    const table = shapeByCNvPrId(doc, tableTail);
    if (!table) return undefined;
    const tbl = first(table, 'tbl');
    if (!tbl) return undefined;
    const row = directChildren(tbl, 'tr')[Number(item.location?.['row'])];
    return row ? directChildren(row, 'tc')[Number(item.location?.['column'])] : undefined;
  }
  const id = cNvPrIdOf(item);
  return id ? shapeByCNvPrId(doc, id) : undefined;
};

/** Narrow a shape node to paragraph or run when the target path includes those segments. */
export const focusMutationNode = (
  shape: Element,
  parsed: ParsedTarget | undefined,
): Result<Element> => {
  if (!parsed?.focus) return ok(shape);
  if (parsed.focus === 'paragraph' && parsed.paragraph !== undefined) {
    const paragraphs = descendants(shape, 'p');
    const p = paragraphs[parsed.paragraph];
    if (!p)
      return err(
        'TARGET_NOT_FOUND',
        `paragraph:${parsed.paragraph} not found on ${parsed.raw}`,
        [],
        { target: parsed.raw },
      );
    return ok(p);
  }
  if (parsed.focus === 'run' && parsed.run !== undefined) {
    const runs = descendants(shape, 'r');
    const run = runs[parsed.run];
    if (!run)
      return err('TARGET_NOT_FOUND', `run:${parsed.run} not found on ${parsed.raw}`, [], {
        target: parsed.raw,
      });
    return ok(run);
  }
  return ok(shape);
};
