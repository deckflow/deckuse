import { XMLSerializer, type Element, type Node } from '@xmldom/xmldom';
import { children, descendants, NS } from './xml.js';

interface Span {
  start: number;
  end: number;
  text: Element;
  run: Element | undefined;
}

const drawingElement = (node: Node | null, name: string): node is Element =>
  node?.nodeType === 1 &&
  (node as Element).namespaceURI === NS.a &&
  (node as Element).localName === name;

export function planTextReplacement(
  target: Node,
  indexedText: string,
  pattern: RegExp,
  replacement: string,
  regex: boolean,
): () => void {
  let text = '';
  const spans: Span[] = descendants(target, 't').map((node) => {
    const start = text.length;
    text += node.textContent ?? '';
    return {
      start,
      end: text.length,
      text: node,
      run:
        drawingElement(node, 't') && drawingElement(node.parentNode, 'r')
          ? node.parentNode
          : undefined,
    };
  });
  if (text !== indexedText) throw new Error('Indexed text does not match the writable XML');
  const body = children(target).find(
    (node) =>
      node.localName === 'txBody' && (node.namespaceURI === NS.a || node.namespaceURI === NS.p),
  );
  const serializer = new XMLSerializer();
  const edits: (() => void)[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    // Let JavaScript expand capture references, including named groups and context tokens.
    const sticky =
      regex && replacement.includes('$') ? new RegExp(pattern.source, 'uy') : undefined;
    if (sticky) sticky.lastIndex = start;
    const value = sticky
      ? text
          .replace(sticky, replacement)
          .slice(start, text.length - end ? -(text.length - end) : undefined)
      : replacement;
    if (value === match[0]) continue;
    if (start === end || /[\r\n]/.test(value))
      throw new Error('Replacement would insert text without a run or change line structure');
    const affected = spans.filter((span) => span.end > start && span.start < end);
    const first = affected[0];
    const last = affected.at(-1);
    const paragraph = first?.run?.parentNode ?? null;
    if (
      !first?.run ||
      !last?.run ||
      !drawingElement(paragraph, 'p') ||
      !body ||
      paragraph.parentNode !== body ||
      affected.some((span) => span.run?.parentNode !== paragraph)
    )
      throw new Error('Match crosses a paragraph, field, or unsupported text structure');
    const siblings = children(paragraph);
    const between = siblings.slice(siblings.indexOf(first.run), siblings.indexOf(last.run) + 1);
    if (between.some((run) => !drawingElement(run, 'r')))
      throw new Error('Match crosses a field, line break, or inline object');
    const formats = between.map((run) =>
      children(run)
        .filter((node) => node.localName !== 't')
        .map((node) => serializer.serializeToString(node))
        .join(''),
    );
    if (formats.some((format) => format !== formats[0]))
      throw new Error('Match crosses runs with different formatting');
    edits.push(() => {
      const prefix = (first.text.textContent ?? '').slice(0, start - first.start);
      const suffix = (last.text.textContent ?? '').slice(end - last.start);
      first.text.textContent = prefix + value + (first === last ? suffix : '');
      for (const span of affected.slice(1)) span.text.textContent = span === last ? suffix : '';
    });
  }
  return () => {
    for (const edit of edits.reverse()) edit();
  };
}
