import { DEFAULT_SLIDE_HEIGHT_EMU, DEFAULT_SLIDE_WIDTH_EMU } from '../core/index.js';

/** Choice accepts at most 255 options. Stay under that so one request can rank a window. */
export const FIND_CHOICE_LIMIT = 200;
/** Split a container into windows of this size before a coarse Choice. */
export const FIND_CHUNK_SIZE = 150;
/** Stop taking containers once their probabilities add up to this, or the count cap. */
export const FIND_CONTAINER_CUMULATIVE = 0.9;
export const FIND_MAX_CONTAINERS = 12;
/** Heads kept from each incomparable Choice window before absolute Noul rescoring. */
export const FIND_TOP_PER_CHUNK = 5;
export const FIND_TEXT_LIMIT = 240;
export const FIND_PREVIEW_LIMIT = 200;
/** Drop ranked leftovers at or below this share. A clear top hit is kept even if the model's yes/no score is modest. */
export const FIND_MATCH_FLOOR = 0.05;

export interface FindCandidate {
  target: string;
  uid?: string;
  kind: string;
  /** Grouping key for the coarse pass, such as `slide 2` or `section 1`. */
  container: string;
  name?: string;
  /** Text sent to the model. May include chart titles and placeholder roles. */
  text?: string;
  /** Caller-facing text, sliced the same way as search. */
  matchText?: string;
  context?: string;
  slide?: number;
  place?: string;
}

export interface CatalogEntry extends FindCandidate {
  id: string;
}

export const catalogId = (index: number): string => `E${String(index + 1).padStart(3, '0')}`;

export const assignCatalogIds = (candidates: readonly FindCandidate[]): CatalogEntry[] =>
  candidates.map((candidate, index) => ({ ...candidate, id: catalogId(index) }));

export const truncateFindText = (
  text: string | undefined,
  limit = FIND_TEXT_LIMIT,
): string | undefined => {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1)}…`;
};

const finiteNumber = (value: number | boolean | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Coarse position on the slide. The model sees a label such as `top-right`, not raw EMU.
 */
export const coarsePlace = (
  transform: Record<string, number | boolean> | undefined,
  slideWidth = DEFAULT_SLIDE_WIDTH_EMU,
  slideHeight = DEFAULT_SLIDE_HEIGHT_EMU,
): string | undefined => {
  if (!transform || slideWidth <= 0 || slideHeight <= 0) return undefined;
  const x = finiteNumber(transform['x']);
  const y = finiteNumber(transform['y']);
  if (x === undefined || y === undefined) return undefined;
  const cx = x + (finiteNumber(transform['width']) ?? 0) / 2;
  const cy = y + (finiteNumber(transform['height']) ?? 0) / 2;
  const col = cx < slideWidth / 3 ? 'left' : cx > (slideWidth * 2) / 3 ? 'right' : 'center';
  const row = cy < slideHeight / 3 ? 'top' : cy > (slideHeight * 2) / 3 ? 'bottom' : 'center';
  if (row === 'center' && col === 'center') return 'center';
  if (row === 'bottom' && col === 'center') return 'bottom';
  if (row === 'top' && col === 'center') return 'top';
  if (row === 'center') return col;
  return `${row}-${col}`;
};
