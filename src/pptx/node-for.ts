import type { Document, Element } from '@xmldom/xmldom';
import { cNvPrIdOf } from './addressing.js';
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
