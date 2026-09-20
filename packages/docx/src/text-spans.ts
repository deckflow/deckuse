import type { Element } from '@xmldom/xmldom';
import { children, writeTextNode } from './xml.js';

const PROTECTED = new Set([
  'sdt',
  'del',
  'ins',
  'moveFrom',
  'moveTo',
  'oMath',
  'oMathPara',
  'fldSimple',
  'fldChar',
  'instrText',
  'customXml',
  'commentRangeStart',
  'commentRangeEnd',
  'commentReference',
]);

const SKIP = new Set([
  'pPr',
  'rPr',
  'bookmarkStart',
  'bookmarkEnd',
  'proofErr',
  'permStart',
  'permEnd',
  'sectPr',
  'lastRenderedPageBreak',
]);

export interface TextSpan {
  start: number;
  end: number;
  node: Element;
  run: Element;
  protected: boolean;
}

export interface ParagraphText {
  text: string;
  spans: TextSpan[];
}

/**
 * Concatenate visible `w:t` text in a paragraph. `w:proofErr` and bookmarks are
 * skipped so a match can cross run boundaries. Protected markup (revisions,
 * fields, content controls) stays in the string so overlap can be rejected.
 */
export const collectSpans = (paragraph: Element): ParagraphText => {
  const acc: ParagraphText = { text: '', spans: [] };
  walk(paragraph, acc, false);
  return acc;
};

const walk = (container: Element, acc: ParagraphText, inheritedProtected: boolean): void => {
  for (const child of children(container)) {
    const name = child.localName ?? '';
    const protectedHere = inheritedProtected || PROTECTED.has(name);
    if (name === 'r') {
      for (const inner of children(child)) {
        if (inner.localName !== 't') continue;
        const value = inner.textContent ?? '';
        const start = acc.text.length;
        acc.text += value;
        acc.spans.push({
          start,
          end: start + value.length,
          node: inner,
          run: child,
          protected: protectedHere,
        });
      }
      continue;
    }
    if (SKIP.has(name)) continue;
    if (children(child).length > 0) walk(child, acc, protectedHere);
  }
};

export const visibleRuns = (paragraph: Element): Element[] => {
  const runs: Element[] = [];
  const seen = new Set<Element>();
  for (const span of collectSpans(paragraph).spans) {
    if (span.protected || seen.has(span.run)) continue;
    seen.add(span.run);
    runs.push(span.run);
  }
  return runs;
};

const applyRange = (spans: TextSpan[], start: number, end: number, replacement: string): void => {
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (!first || !last) return;
  const firstText = first.node.textContent ?? '';
  const lastText = last.node.textContent ?? '';
  const prefix = firstText.slice(0, Math.max(0, start - first.start));
  const suffix = lastText.slice(Math.max(0, end - last.start));
  if (first === last) {
    writeTextNode(first.node, `${prefix}${replacement}${suffix}`);
    return;
  }
  writeTextNode(first.node, `${prefix}${replacement}`);
  for (let index = 1; index < spans.length - 1; index += 1) {
    const span = spans[index];
    if (span) writeTextNode(span.node, '');
  }
  writeTextNode(last.node, suffix);
};

export const replaceInParagraph = (
  paragraph: Element,
  find: string,
  replacement: string,
  regex: boolean,
  maxMatches?: number,
): { matched: number } | { error: string } => {
  let pattern: RegExp | undefined;
  if (regex) {
    try {
      pattern = new RegExp(find, 'g');
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Invalid regular expression' };
    }
  }
  let matched = 0;
  for (let guard = 0; guard < 10_000; guard += 1) {
    const { text, spans } = collectSpans(paragraph);
    let start = -1;
    let end = -1;
    if (pattern) {
      pattern.lastIndex = 0;
      const found = pattern.exec(text);
      if (!found || found[0].length === 0) break;
      start = found.index;
      end = start + found[0].length;
    } else {
      start = text.indexOf(find);
      if (start < 0) break;
      end = start + find.length;
    }
    const overlapping = spans.filter((span) => span.end > start && span.start < end);
    if (overlapping.length === 0) break;
    if (overlapping.some((span) => span.protected)) {
      return {
        error: 'Match overlaps tracked changes, fields, comments, content controls, or equations',
      };
    }
    applyRange(overlapping, start, end, replacement);
    matched += 1;
    if (maxMatches !== undefined && matched >= maxMatches) break;
  }
  return { matched };
};
