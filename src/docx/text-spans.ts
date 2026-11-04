import { XMLSerializer, type Element } from '@xmldom/xmldom';
import { children, writeTextNode, isProtectedMarkup, protectionReason } from './xml.js';

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
    const protectedHere = inheritedProtected || isProtectedMarkup(child);
    if (name === 'r') {
      for (const inner of children(child)) {
        if (inner.localName === 'rPr') continue;
        if (inner.localName !== 't') {
          acc.text += '\u0000';
          continue;
        }
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
    if (name === 'hyperlink') {
      acc.text += '\u0000';
      walk(child, acc, protectedHere);
      acc.text += '\u0000';
    } else if (children(child).length > 0 && isProtectedMarkup(child)) walk(child, acc, true);
    else acc.text += '\u0000';
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

export interface ReplacementChange {
  start: number;
  end: number;
  replacement: string;
  policy: 'safe' | 'firstRun';
  formats: string[];
  runs: number[];
}

const formatOf = (span: TextSpan): string => {
  const properties = children(span.run).find((n) => n.localName === 'rPr');
  return properties ? new XMLSerializer().serializeToString(properties) : '';
};

export const replaceInParagraph = (
  paragraph: Element,
  find: string,
  replacement: string,
  regex: boolean,
  maxMatches?: number,
  policy: 'safe' | 'firstRun' = 'safe',
):
  | { matched: number; changes: ReplacementChange[] }
  | { error: string; invalid?: boolean; details?: Record<string, unknown> } => {
  const { text, spans } = collectSpans(paragraph);
  let pattern: RegExp;
  try {
    pattern = new RegExp(regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu');
  } catch (cause) {
    return { error: String(cause), invalid: true };
  }
  const changes: ReplacementChange[] = [];
  let matched = 0;
  for (const match of text.matchAll(pattern)) {
    if (maxMatches !== undefined && matched >= maxMatches) break;
    if (!match[0].length)
      return { error: 'Zero-length regex matches are not supported', invalid: true };
    let start = match.index;
    let end = start + match[0].length;
    if (match[0].includes('\u0000')) return { error: 'Match crosses an inline object boundary' };
    const original = spans.filter((s) => s.end > start && s.start < end);
    if (original.some((s) => s.protected || protectionReason(s.run) !== undefined))
      return { error: 'Match overlaps protected markup' };
    let value = replacement;
    if (policy === 'safe') {
      const old = Array.from(match[0]);
      const next = Array.from(value);
      while (old.length && next.length && old[0] === next[0]) {
        start += (old.shift() ?? '').length;
        next.shift();
      }
      while (old.length && next.length && old.at(-1) === next.at(-1)) {
        end -= (old.pop() ?? '').length;
        next.pop();
      }
      value = next.join('');
    }
    matched++;
    if (start === end && !value) continue;
    const affected = spans.filter((s) =>
      start === end
        ? s.start <= start && s.end >= end && s.end > s.start
        : s.end > start && s.start < end,
    );
    const formats = [...new Set(affected.map(formatOf))];
    const paragraphRuns = Array.from(
      paragraph.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'r',
      ),
    );
    const runs = [...new Set(affected.map((span) => paragraphRuns.indexOf(span.run)))];
    if (policy === 'safe' && formats.length > 1)
      return {
        error:
          'Ambiguous run formatting; use formatPolicy firstRun explicitly or narrow the replacement',
        details: { start, end, policy, formats, runs },
      };
    if (!affected.length) return { error: 'Cannot determine insertion formatting' };
    changes.push({ start, end, replacement: value, policy, formats, runs });
  }
  for (const change of [...changes].reverse()) {
    const affected = spans.filter((s) =>
      change.start === change.end
        ? s.start <= change.start && s.end >= change.end && s.end > s.start
        : s.end > change.start && s.start < change.end,
    );
    applyRange(
      change.start === change.end ? affected.slice(0, 1) : affected,
      change.start,
      change.end,
      change.replacement,
    );
  }
  return { matched, changes };
};
