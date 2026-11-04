import type { Element } from '@xmldom/xmldom';
import { elements } from '../review/xml.js';
import { NS } from './xml.js';
const propsNames = new Set([
  'rPrChange',
  'pPrChange',
  'tblPrChange',
  'tblPrExChange',
  'trPrChange',
  'tcPrChange',
  'tblGridChange',
  'sectPrChange',
]);
const wrapperNames = new Set(['ins', 'del', 'moveFrom', 'moveTo']);
export const supportedRevision = (n: Element): boolean => {
  if (n.namespaceURI !== NS.w) return false;
  if (propsNames.has(n.localName ?? ''))
    return (
      n.parentNode?.nodeType === 1 &&
      elements(n).some(
        (c) => c.namespaceURI === NS.w && c.localName === (n.parentNode as Element).localName,
      )
    );
  if (['cellIns', 'cellDel', 'cellMerge'].includes(n.localName ?? ''))
    return (n.parentNode as Element | null)?.localName === 'tcPr';
  if (/^(moveFrom|moveTo)Range(Start|End)$/.test(n.localName ?? '')) return true;
  if (!wrapperNames.has(n.localName ?? '')) return false;
  const parent = n.parentNode as Element | null;
  if (parent?.localName === 'trPr') return true;
  if (parent?.localName === 'rPr')
    return parent.parentNode?.nodeType === 1 && (parent.parentNode as Element).localName === 'pPr';
  return ['p', 'body', 'tc', 'moveFrom', 'moveTo'].includes(parent?.localName ?? '');
};

/** Text boxes and auxiliary stories are inventory/projection-only in this release. */
export const inWritableBodyStory = (node: Element): boolean => {
  let current: Element | null = node;
  while (current) {
    if (current.namespaceURI === NS.w) {
      if (
        [
          'txbxContent',
          'hdr',
          'ftr',
          'footnote',
          'endnote',
          'comment',
          'sdt',
          'customXml',
        ].includes(current.localName ?? '')
      )
        return false;
      if (current.localName === 'body') return true;
    }
    current = current.parentNode?.nodeType === 1 ? (current.parentNode as Element) : null;
  }
  return false;
};
