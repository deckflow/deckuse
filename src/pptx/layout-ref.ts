import { err, ok, type Result } from '../core/index.js';
import type { OpcArchive } from '../opc/index.js';
import type { IndexFile, IndexedElement } from './types.js';
import { REL, attr, first, root } from './xml.js';

/** Basename of an OPC part URI without the `.xml` suffix (e.g. `slideLayout1`). */
export const layoutPartBaseName = (partUri: string): string =>
  partUri
    .split('/')
    .pop()
    ?.replace(/\.xml$/i, '') ?? '';

/** Natural-sort compare so `slideLayout2` < `slideLayout10`. */
export const naturalCompare = (a: string, b: string): number => {
  const re = /(\d+)|(\D+)/g;
  const as = a.toLowerCase().match(re) ?? [];
  const bs = b.toLowerCase().match(re) ?? [];
  const n = Math.max(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const x = as[i] ?? '';
    const y = bs[i] ?? '';
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
      continue;
    }
    if (xn !== yn) return xn ? -1 : 1;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
};

/** Layouts in stable natural order of part basename (matches `list layouts` index). */
export const orderedLayouts = (index: IndexFile): IndexedElement[] =>
  index.elements
    .filter((item) => item.kind === 'layout')
    .slice()
    .sort((a, b) => naturalCompare(layoutPartBaseName(a.partUri), layoutPartBaseName(b.partUri)));

/** `p:cSld/@name` on a slideLayout part. */
export const layoutDisplayName = (archive: OpcArchive, partUri: string): string => {
  try {
    const cSld = first(archive.readXml(partUri), 'cSld');
    return attr(cSld, 'name') ?? '';
  } catch {
    return '';
  }
};

/** `p:sldLayout/@type` when present. */
export const layoutTypeAttr = (archive: OpcArchive, partUri: string): string | undefined => {
  try {
    const type = attr(root(archive.readXml(partUri)), 'type');
    return type || undefined;
  } catch {
    return undefined;
  }
};

/** Slide→layout relationship target, if any. */
export const slideLayoutPart = (archive: OpcArchive, slidePart: string): string | undefined => {
  const rel = archive.getRelationships(slidePart).find((r) => r.type === REL.layout);
  return rel?.resolvedTarget;
};

export type LayoutListItem = {
  index: number;
  target: string;
  name: string;
  displayName: string;
  type?: string;
  partUri: string;
  uid: string;
};

export const layoutListMeta = (
  archive: OpcArchive,
  item: IndexedElement,
  listIndex: number,
): Omit<LayoutListItem, 'uid'> => {
  const name = layoutPartBaseName(item.partUri);
  const displayName = layoutDisplayName(archive, item.partUri);
  const type = layoutTypeAttr(archive, item.partUri);
  return {
    index: listIndex,
    target: `layout:${name}`,
    name,
    displayName,
    ...(type !== undefined ? { type } : {}),
    partUri: item.partUri,
  };
};

/**
 * Resolve a layout reference used by `addSlide` / `setSlideLayout`.
 *
 * Accepts:
 * - `slide:N` — inherit that slide's layout relationship
 * - bare digit / `layout:N` — 1-based index into {@link orderedLayouts}
 * - display name (`Blank`), basename (`slideLayout2`), or substring of display
 *   (except needle `blank`, which requires an exact Blank match)
 *
 * When `allowBlankFallback` is true and needle is `blank` with no match,
 * returns `ok(undefined)` so callers can fall through to inheritance.
 */
export const resolveLayoutRef = (
  archive: OpcArchive,
  index: IndexFile,
  ref: string,
  options: { allowBlankFallback?: boolean } = {},
): Result<string | undefined> => {
  const raw = ref.trim();
  if (!raw) return err('INVALID_COMMAND', 'Layout reference is empty');

  const slideMatch = /^slide:(\d+)$/i.exec(raw);
  if (slideMatch) {
    const page = Number(slideMatch[1]);
    const slides = index.elements.filter((item) => item.kind === 'slide');
    const slide = slides[page - 1];
    if (!slide)
      return err('TARGET_NOT_FOUND', `slide:${page} does not exist`, [], {
        target: `slide:${page}`,
        hint: 'Run deckuse list slides --json.',
      });
    const part = slideLayoutPart(archive, slide.partUri);
    if (!part)
      return err('TARGET_NOT_FOUND', `slide:${page} has no slideLayout relationship`, [], {
        target: `slide:${page}`,
      });
    return ok(part);
  }

  let indexNeedle: number | undefined;
  const layoutIndexMatch = /^layout:(\d+)$/i.exec(raw);
  if (layoutIndexMatch) indexNeedle = Number(layoutIndexMatch[1]);
  else if (/^\d+$/.test(raw)) indexNeedle = Number(raw);

  const layouts = orderedLayouts(index);
  if (indexNeedle !== undefined) {
    if (!Number.isInteger(indexNeedle) || indexNeedle < 1)
      return err('INVALID_COMMAND', `Invalid layout index: ${raw}`, [], { target: raw });
    const hit = layouts[indexNeedle - 1];
    if (!hit)
      return err('TARGET_NOT_FOUND', `Layout index out of range: ${indexNeedle}`, [], {
        target: `layout:${indexNeedle}`,
        hint: 'Run deckuse list layouts --json.',
      });
    return ok(hit.partUri);
  }

  const needle = raw.toLowerCase().replace(/^layout:/i, '');
  const match = layouts.find((item) => {
    const fileName = layoutPartBaseName(item.partUri).toLowerCase();
    const display = layoutDisplayName(archive, item.partUri).toLowerCase();
    return (
      display === needle || fileName === needle || (needle !== 'blank' && display.includes(needle))
    );
  });

  if (match) return ok(match.partUri);
  if (options.allowBlankFallback && needle === 'blank') return ok(undefined);
  return err('TARGET_NOT_FOUND', `Layout not found: ${ref}`, [], {
    target: raw,
    hint: 'Use a layout index, layout:N, slide:N, display name, or basename (deckuse list layouts --json).',
  });
};
