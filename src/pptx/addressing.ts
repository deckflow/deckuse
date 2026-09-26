import { createHash } from 'node:crypto';
import { err, type ElementRef, type Result } from '../core/index.js';
import type { IndexFile, IndexedElement } from './types.js';
import { orderedLayouts } from './layout-ref.js';
import { findIndexed, slidePageMap } from './indexer.js';

export type TargetKind =
  | 'presentation'
  | 'theme'
  | 'layout'
  | 'master'
  | 'slide'
  | 'shape'
  | 'placeholder'
  | 'notes'
  | 'text'
  | 'paragraph'
  | 'run'
  | 'tableCell';

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
  cellRow?: number;
  cellCol?: number;
  focus?: 'text' | 'paragraph' | 'run' | 'cell';
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
  if (trimmed === 'presentation')
    return { ok: true, value: { raw: trimmed, kind: 'presentation' }, diagnostics: [] };
  if (trimmed === 'theme')
    return { ok: true, value: { raw: trimmed, kind: 'theme' }, diagnostics: [] };

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
  } else if (second === 'notes') {
    parsed = { ...parsed, kind: 'notes' };
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
  if (third.startsWith('cell:')) {
    const rest = third.slice('cell:'.length);
    const [rowRaw, colRaw] = rest.split(':');
    const row = Number(rowRaw);
    const col = Number(colRaw);
    if (!Number.isInteger(row) || row < 0 || !Number.isInteger(col) || col < 0)
      return err('INVALID_COMMAND', `Invalid cell address: ${trimmed}`, [], { target: trimmed });
    return {
      ok: true,
      value: {
        ...parsed,
        kind: 'tableCell',
        cellRow: row,
        cellCol: col,
        focus: 'cell',
      },
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
      SHAPE_KINDS.has(item.kind) && item.partUri === slide.partUri && item.kind !== 'tableCell',
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
    const name =
      item.partUri
        .split('/')
        .pop()
        ?.replace(/\.xml$/, '') ?? item.partUri;
    return `layout:${name}`;
  }
  if (item.kind === 'master') {
    const name =
      item.partUri
        .split('/')
        .pop()
        ?.replace(/\.xml$/, '') ?? item.partUri;
    return `master:${name}`;
  }
  if (item.kind === 'theme') return 'theme';
  if (item.kind === 'notes') {
    const page =
      (item.slideId ? pages.get(item.slideId) : undefined) ??
      (typeof item.location?.['slidePart'] === 'string'
        ? pages.get(item.location['slidePart'])
        : undefined);
    return page ? `slide:${page}/notes` : (item.ref.elementId ?? 'notes');
  }
  if (item.kind === 'tableCell') {
    const page = (item.slideId ? pages.get(item.slideId) : undefined) ?? pages.get(item.partUri);
    const tableId = typeof item.location?.['tableId'] === 'string' ? item.location['tableId'] : '';
    const afterSlide = tableId.includes(':') ? tableId.slice(tableId.indexOf(':') + 1) : tableId;
    const shapeId = afterSlide.split('.').at(-1) ?? afterSlide;
    const row = item.location?.['row'];
    const col = item.location?.['column'];
    if (page && shapeId && typeof row === 'number' && typeof col === 'number')
      return `slide:${page}/shape:${shapeId}/cell:${row}:${col}`;
  }
  if (item.slideId || item.partUri) {
    const page = (item.slideId ? pages.get(item.slideId) : undefined) ?? pages.get(item.partUri);
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

/** Basename of an OPC part URI without the `.xml` suffix (e.g. `slideLayout1`). */
const partBaseName = (partUri: string): string =>
  partUri
    .split('/')
    .pop()
    ?.replace(/\.xml$/i, '') ?? '';

/**
 * Match layout/master parts by exact basename, display name, or full part URI.
 * Avoid substring `includes` — `slideLayout1` must not match `slideLayout10`.
 */
const matchNamedParts = (
  index: IndexFile,
  kind: 'layout' | 'master',
  needleRaw: string,
): IndexedElement[] => {
  const needle = needleRaw.toLowerCase();
  return index.elements.filter((el) => {
    if (el.kind !== kind) return false;
    const base = partBaseName(el.partUri).toLowerCase();
    const uri = el.partUri.toLowerCase();
    return (
      base === needle ||
      (el.name?.toLowerCase() ?? '') === needle ||
      uri === needle ||
      uri.endsWith(`/${needle}.xml`)
    );
  });
};

export function resolveTarget(index: IndexFile, raw: string): Result<ResolvedTarget> {
  const parsedResult = parseTargetPath(raw);
  if (!parsedResult.ok) return parsedResult;
  const parsed = parsedResult.value;

  if (parsed.kind === 'presentation') {
    const first = index.elements.find((item) => item.kind === 'slide');
    if (!first) return err('TARGET_NOT_FOUND', 'Presentation has no slides', [], { target: raw });
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
    // Numeric layout:N matches list layouts 1-based index (natural basename order).
    if (/^\d+$/.test(parsed.layout)) {
      const page = Number(parsed.layout);
      const layouts = orderedLayouts(index);
      const item = layouts[page - 1];
      if (!item)
        return err('TARGET_NOT_FOUND', `Layout index out of range: ${page}`, [], {
          target: raw,
          hint: 'Run deckuse list layouts --json.',
        });
      return {
        ok: true,
        value: { target: targetPathForItem(index, item), uid: uidForItem(item), item, parsed },
        diagnostics: [],
      };
    }
    const matches = matchNamedParts(index, 'layout', parsed.layout);
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
    const matches = matchNamedParts(index, 'master', parsed.master);
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

  if (parsed.kind === 'notes') {
    const notes = index.elements.find(
      (item) => item.kind === 'notes' && item.slideId === slide.slideId,
    );
    if (notes) {
      return {
        ok: true,
        value: {
          target: `slide:${parsed.slide}/notes`,
          uid: uidForItem(notes),
          item: notes,
          slidePage: parsed.slide,
          parsed,
        },
        diagnostics: [],
      };
    }
    // Synthetic notes target — mutate will call ensureNotes before writing.
    const slideId = slide.slideId ?? String(parsed.slide);
    const synthetic: IndexedElement = {
      ref: {
        documentId: slide.ref.documentId,
        elementId: `notes:${slideId}`,
        path: '',
        revision: slide.ref.revision,
      },
      kind: 'notes',
      partUri: '',
      slideId,
      location: {
        slideId,
        partUri: '',
        region: 'speakerNotes',
        slidePart: slide.partUri,
        needsCreate: true,
      },
    };
    return {
      ok: true,
      value: {
        target: `slide:${parsed.slide}/notes`,
        uid: uidForItem(synthetic),
        item: synthetic,
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
    return err('TARGET_NOT_FOUND', `${label} does not exist on slide:${parsed.slide}`, [], {
      target: raw,
      hint: `Run deckuse list shapes --slide ${parsed.slide} --json.`,
    });
  }

  if (parsed.kind === 'tableCell' && parsed.cellRow !== undefined && parsed.cellCol !== undefined) {
    if (item.kind !== 'table')
      return err('TARGET_NOT_FOUND', `shape:${cNvPrIdOf(item) ?? '?'} is not a table`, [], {
        target: raw,
      });
    const cell = index.elements.find(
      (el) =>
        el.kind === 'tableCell' &&
        el.parentId === item.ref.elementId &&
        el.location?.['row'] === parsed.cellRow &&
        el.location?.['column'] === parsed.cellCol,
    );
    if (!cell)
      return err(
        'TARGET_NOT_FOUND',
        `cell:${parsed.cellRow}:${parsed.cellCol} does not exist on slide:${parsed.slide}/shape:${cNvPrIdOf(item) ?? '?'}`,
        [],
        { target: raw },
      );
    const canonical = targetPathForItem(index, cell);
    return {
      ok: true,
      value: {
        target: canonical,
        uid: uidForItem(cell),
        item: cell,
        slidePage: parsed.slide,
        parsed,
      },
      diagnostics: [],
    };
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
  if (!targetOrRef.target) return err('INVALID_COMMAND', 'ref or target is required');
  const resolved = resolveTarget(index, targetOrRef.target);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    value: { ref: resolved.value.item.ref, resolved: resolved.value },
    diagnostics: [],
  };
}

export { cNvPrIdOf, shapesOnSlide, slideByPage };
