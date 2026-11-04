import type { Document, Element } from '@xmldom/xmldom';
import { hitsFrom } from './indexer.js';
import { NS, protectionReason, writeTextNode } from './xml.js';
import { all, checkedOffset, elements, make } from '../review/xml.js';
export const paragraphAt = (doc: Document, target: string): Element => {
  const hit = hitsFrom(doc, undefined).find(
    (h) => h.path === target || (h.paraId && `para:${h.paraId}` === target),
  );
  if (hit?.kind !== 'paragraph') throw new Error(`Paragraph not found: ${target}`);
  return hit.element;
};
export const plainText = (node: Element): string =>
  all(node, NS.w, 't')
    .map((n) => n.textContent ?? '')
    .join('');
export const assertPlain = (p: Element): void => {
  const reason = protectionReason(p);
  if (reason) throw new Error(reason);
  for (const child of elements(p)) {
    if (child.namespaceURI !== NS.w || !['pPr', 'r'].includes(child.localName ?? ''))
      throw new Error('Range requires ordinary text runs');
    if (
      child.localName === 'r' &&
      elements(child).some(
        (n) => n.namespaceURI !== NS.w || !['rPr', 't'].includes(n.localName ?? ''),
      )
    )
      throw new Error('Range intersects non-text run content');
  }
};
/** Return the child at a character boundary, splitting only the touched run. */
export const boundary = (p: Element, offset: number): Element | null => {
  checkedOffset(plainText(p), offset);
  let position = 0;
  for (const r of elements(p).filter((n) => n.localName === 'r' && n.namespaceURI === NS.w)) {
    const text = plainText(r);
    if (offset === position) return r;
    if (offset < position + text.length) {
      const cut = offset - position;
      const right = r.cloneNode(true) as Element;
      for (const n of all(r, NS.w, 't')) n.parentNode?.removeChild(n);
      for (const n of all(right, NS.w, 't')) n.parentNode?.removeChild(n);
      const leftText = make(p.ownerDocument, NS.w, 'w:t');
      writeTextNode(leftText, text.slice(0, cut));
      r.appendChild(leftText);
      const rightText = make(p.ownerDocument, NS.w, 'w:t');
      writeTextNode(rightText, text.slice(cut));
      right.appendChild(rightText);
      p.insertBefore(right, r.nextSibling);
      return right;
    }
    position += text.length;
  }
  return null;
};
export const textRun = (
  doc: Document,
  text: string,
  deleted = false,
  template?: Element,
): Element => {
  const r = make(doc, NS.w, 'w:r');
  const props = template && elements(template).find((n) => n.localName === 'rPr');
  if (props) r.appendChild(props.cloneNode(true));
  const t = make(doc, NS.w, deleted ? 'w:delText' : 'w:t');
  writeTextNode(t, text);
  r.appendChild(t);
  return r;
};
