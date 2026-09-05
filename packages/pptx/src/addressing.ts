import { createHash } from 'node:crypto';
import { err, type ElementRef, type Result } from '@deckflow/deckuse-core';
import type { IndexFile, IndexedElement } from './types.js';
import { findIndexed, slidePageMap } from './indexer.js';

export type TargetKind =
  | 'presentation'
  | 'theme'
  | 'layout'
  | 'master'
  | 'slide'
  | 'shape'
  | 'placeholder'
  | 'text'
  | 'paragraph'
  | 'run';

export interface ParsedTarget {
  raw: string;
  kind: TargetKind;
  slide?: number;
  shapeId?: string;
  shapeName?: string;
  placeholder?: string;
  layout?: string;
  master?: string;
  paragraph?: number;
  run?: number;
  focus?: 'text' | 'paragraph' | 'run';
}

export interface ResolvedTarget {
  target: string;
  uid: string;
  item: IndexedElement;
  slidePage?: number;
  parsed: ParsedTarget;
}

const SHAPE_KINDS = new Set([
  'shape',
  'textbox',
  'picture',
  'video',
  'audio',
  'connector',
  'group',
  'table',
  'chart',
]);

export const stableUid = (parts: {
  documentId: string;
  partUri: string;
  cNvPrId?: string;
  kind: string;
}): string => {
  const key = `${parts.documentId}|${parts.partUri}|${parts.cNvPrId ?? ''}|${parts.kind}`;
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 32);
  const prefix =
    parts.kind === 'slide'
      ? 'sld'
      : parts.kind === 'textbox'
        ? 'tx'
        : parts.kind === 'picture'
          ? 'pic'
          : parts.kind === 'master'
            ? 'mst'
            : parts.kind === 'layout'
              ? 'lay'
              : parts.kind === 'theme'
                ? 'thm'
                : 'sp';
  return `du:${prefix}:${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
};

export function parseTargetPath(raw: string): Result<ParsedTarget> {
  const trimmed = raw.trim();
  if (!trimmed) return err('INVALID_COMMAND', 'Target path is empty');
  if (trimmed === 'presentation') return { ok: true, value: { raw: trimmed, kind: 'presentation' }, diagnostics: [] };
  if (trimmed === 'theme') return { ok: true, value: { raw: trimmed, kind: 'theme' }, diagnostics: [] };

  const segments = trimmed.split('/');
  const head = segments[0] ?? '';
  if (head.startsWith('layout:')) {
    return {
      ok: true,
      value: { raw: trimmed, kind: 'layout', layout: head.slice('layout:'.length) },
      diagnostics: [],
    };
  }
  if (head.startsWith('master:')) {
    return {
      ok: true,
      value: { raw: trimmed, kind: 'master', master: head.slice('master:'.length) },
      diagnostics: [],
    };
  }
  if (!head.startsWith('slide:'))
    return err('INVALID_COMMAND', `Unrecognized target path: ${trimmed}`, [], {
      target: trimmed,
      hint: 'Use slide:<n>/shape:<id-or-name>, layout:<name>, master:<name>, or theme.',
    });

  const slide = Number(head.slice('slide:'.length));
  if (!Number.isInteger(slide) || slide < 1)
    return err('INVALID_COMMAND', `Invalid slide index in target: ${trimmed}`, [], {
      target: trimmed,
    });

  if (segments.length === 1)
    return { ok: true, value: { raw: trimmed, kind: 'slide', slide }, diagnostics: [] };

  const second = segments[1] ?? '';
  let parsed: ParsedTarget = { raw: trimmed, kind: 'slide', slide };

  if (second.startsWith('shape:')) {
    const token = second.slice('shape:'.length);
    if (!token)
      return err('INVALID_COMMAND', `Missing shape id in target: ${trimmed}`, [], {
        target: trimmed,
      });
    const asNum = Number(token);
    parsed = {
      ...parsed,
      kind: 'shape',
      ...(Number.isInteger(asNum) && String(asNum) === token
        ? { shapeId: token }
        : { shapeName: token }),
    };
  } else if (second.startsWith('placeholder:')) {
    parsed = {
      ...parsed,
      kind: 'placeholder',
      placeholder: second.slice('placeholder:'.length),
    };
  } else {
    return err('INVALID_COMMAND', `Unrecognized target segment: ${second}`, [], {
      target: trimmed,
    });
  }

  if (segments.length === 2) return { ok: true, value: parsed, diagnostics: [] };

  const third = segments[2] ?? '';
  if (third === 'text') {
    return {
      ok: true,
      value: { ...parsed, kind: 'text', focus: 'text' },
      diagnostics: [],
    };
  }
  if (third.startsWith('paragraph:')) {
    const n = Number(third.slice('paragraph:'.length));
    if (!Number.isInteger(n) || n < 0)
      return err('INVALID_COMMAND', `Invalid paragraph index: ${trimmed}`, [], {
        target: trimmed,
      });
    return {
      ok: true,
      value: { ...parsed, kind: 'paragraph', paragraph: n, focus: 'paragraph' },
      diagnostics: [],
    };
  }
  if (third.startsWith('run:')) {
    const n = Number(third.slice('run:'.length));
    if (!Number.isInteger(n) || n < 0)
      return err('INVALID_COMMAND', `Invalid run index: ${trimmed}`, [], { target: trimmed });
    return {
      ok: true,
      value: { ...parsed, kind: 'run', run: n, focus: 'run' },
      diagnostics: [],
    };
  }
  return err('INVALID_COMMAND', `Unrecognized target path: ${trimmed}`, [], { target: trimmed });
}

const slideByPage = (index: IndexFile, page: number): IndexedElement | undefined => {
  const slides = index.elements.filter((item) => item.kind === 'slide');
  return slides[page - 1];
};

const shapesOnSlide = (index: IndexFile, slide: IndexedElement): IndexedElement[] =>
  index.elements.filter(
    (item) =>
      SHAPE_KINDS.has(item.kind) &&
      item.partUri === slide.partUri &&
      item.kind !== 'tableCell',
  );

const cNvPrIdOf = (item: IndexedElement): string | undefined =>
  typeof item.location?.['cNvPrId'] === 'string'
    ? item.location['cNvPrId']
    : item.ref.elementId?.includes(':')
      ? item.ref.elementId.split(':').slice(1).join(':').split('.').at(-1)
      : undefined;

export function targetPathForItem(index: IndexFile, item: IndexedElement): string {
  const pages = slidePageMap(index);
  if (item.kind === 'slide') {
    const page = pages.get(item.partUri) ?? (item.slideId ? pages.get(item.slideId) : undefined);
    return page ? `slide:${page}` : `slide:?`;
  }
  if (item.kind === 'layout') {
    const name = item.partUri.split('/').pop()?.replace(/\.xml$/, '') ?? item.partUri;
    return `layout:${name}`;
  }
  if (item.kind === 'master') {
    const name = item.partUri.split('/').pop()?.replace(/\.xml$/, '') ?? item.partUri;
    return `master:${name}`;
  }
  if (item.kind === 'theme') return 'theme';
  if (item.slideId || item.partUri) {
    const page =
      (item.slideId ? pages.get(item.slideId) : undefined) ?? pages.get(item.partUri);
    const id = cNvPrIdOf(item);
    if (page && id) return `slide:${page}/shape:${id}`;
  }
  return item.ref.elementId ?? item.ref.path ?? 'unknown';
}

export function uidForItem(item: IndexedElement): string {
  const cNvPrId = cNvPrIdOf(item);
  return stableUid({
    documentId: item.ref.documentId,
    partUri: item.partUri,
    ...(cNvPrId !== undefined ? { cNvPrId } : {}),
    kind: item.kind,
  });
}

export function resolveTarget(
  index: IndexFile,
  raw: string,
): Result<ResolvedTarget> {
  const parsedResult = parseTargetPath(raw);
  if (!parsedResult.ok) return parsedResult;
  const parsed = parsedResult.value;

  if (parsed.kind === 'presentation') {
    const first = index.elements.find((item) => item.kind === 'slide');
    if (!first)
      return err('TARGET_NOT_FOUND', 'Presentation has no slides', [], { target: raw });
    return {
      ok: true,
      value: {
        target: 'presentation',
        uid: stableUid({
          documentId: first.ref.documentId,
          partUri: '/ppt/presentation.xml',
          kind: 'presentation',
        }),
        item: first,
        parsed,
      },
      diagnostics: [],
    };
  }

  if (parsed.kind === 'theme') {
    const item = index.elements.find((el) => el.kind === 'theme');
    if (!item) return err('TARGET_NOT_FOUND', 'Theme not found', [], { target: raw });
    return {
      ok: true,
      value: {
        target: 'theme',
        uid: uidForItem(item),
        item,
        parsed,
      },
      diagnostics: [],
    };
  }

  if (parsed.kind === 'layout' && parsed.layout) {
    const needle = parsed.layout.toLowerCase();
    const matches = index.elements.filter((el) => {
      if (el.kind !== 'layout') return false;
      const name = el.partUri.split('/').pop()?.replace(/\.xml$/, '') ?? '';
      return (
        name.toLowerCase() === needle ||
        el.partUri.toLowerCase().includes(needle) ||
        (el.name?.toLowerCase() ?? '') === needle
      );
    });
    if (matches.length === 0)
      return err('TARGET_NOT_FOUND', `Layout not found: ${parsed.layout}`, [], { target: raw });
    if (matches.length > 1)
      return err('AMBIGUOUS_NAME', `Layout name is ambiguous: ${parsed.layout}`, [], {
        target: raw,
      });
    const item = matches[0]!;
    return {
      ok: true,
      value: { target: targetPathForItem(index, item), uid: uidForItem(item), item, parsed },
      diagnostics: [],
    };
  }

  if (parsed.kind === 'master' && parsed.master) {
    const needle = parsed.master.toLowerCase();
    const matches = index.elements.filter((el) => {
      if (el.kind !== 'master') return false;
      const name = el.partUri.split('/').pop()?.replace(/\.xml$/, '') ?? '';
      return (
        name.toLowerCase() === needle ||
        el.partUri.toLowerCase().includes(needle) ||
        (el.name?.toLowerCase() ?? '') === needle
      );
    });
    if (matches.length === 0)
      return err('TARGET_NOT_FOUND', `Master not found: ${parsed.master}`, [], { target: raw });
    if (matches.length > 1)
      return err('AMBIGUOUS_NAME', `Master name is ambiguous: ${parsed.master}`, [], {
        target: raw,
      });
    const item = matches[0]!;
    return {
      ok: true,
      value: { target: targetPathForItem(index, item), uid: uidForItem(item), item, parsed },
      diagnostics: [],
    };
  }

  if (parsed.slide === undefined)
    return err('INVALID_COMMAND', `Invalid target: ${raw}`, [], { target: raw });

  const slide = slideByPage(index, parsed.slide);
  if (!slide)
    return err('TARGET_NOT_FOUND', `slide:${parsed.slide} does not exist`, [], {
      target: raw,
      hint: 'Run deckuse list slides --json.',
    });

  if (parsed.kind === 'slide') {
    return {
      ok: true,
      value: {
        target: `slide:${parsed.slide}`,
        uid: uidForItem(slide),
        item: slide,
        slidePage: parsed.slide,
        parsed,
      },
      diagnostics: [],
    };
  }

  const shapes = shapesOnSlide(index, slide);
  let matches: IndexedElement[] = [];
  if (parsed.shapeId) {
    matches = shapes.filter((item) => cNvPrIdOf(item) === parsed.shapeId);
  } else if (parsed.shapeName) {
    matches = shapes.filter((item) => item.name === parsed.shapeName);
    if (matches.length > 1)
      return err(
        'AMBIGUOUS_NAME',
        `Shape name "${parsed.shapeName}" is ambiguous on slide:${parsed.slide}`,
        [],
        { target: raw },
      );
  } else if (parsed.placeholder) {
    matches = shapes.filter((item) => {
      const role = item.payload?.['placeholder'];
      return typeof role === 'string' && role === parsed.placeholder;
    });
  }

  const item = matches[0];
  if (!item) {
    const label = parsed.shapeId
      ? `shape:${parsed.shapeId}`
      : parsed.shapeName
        ? `shape:${parsed.shapeName}`
        : `placeholder:${parsed.placeholder ?? '?'}`;
    return err(
      'TARGET_NOT_FOUND',
      `${label} does not exist on slide:${parsed.slide}`,
      [],
      {
        target: raw,
        hint: `Run deckuse list shapes --slide ${parsed.slide} --json.`,
      },
    );
  }

  const id = cNvPrIdOf(item) ?? '?';
  const canonical = `slide:${parsed.slide}/shape:${id}`;
  return {
    ok: true,
    value: {
      target: canonical,
      uid: uidForItem(item),
      item,
      slidePage: parsed.slide,
      parsed,
    },
    diagnostics: [],
  };
}

export function resolveToRef(
  index: IndexFile,
  targetOrRef: { target?: string; ref?: ElementRef },
): Result<{ ref: ElementRef; resolved?: ResolvedTarget }> {
  if (targetOrRef.ref) {
    const item = findIndexed(index, targetOrRef.ref);
    if (!item) return err('ELEMENT_NOT_FOUND', 'Element reference was not found');
    return { ok: true, value: { ref: item.ref }, diagnostics: [] };
  }
  if (!targetOrRef.target)
    return err('INVALID_COMMAND', 'ref or target is required');
  const resolved = resolveTarget(index, targetOrRef.target);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    value: { ref: resolved.value.item.ref, resolved: resolved.value },
    diagnostics: [],
  };
}

export { cNvPrIdOf, shapesOnSlide, slideByPage };
