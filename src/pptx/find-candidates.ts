import type { Command } from '../core/index.js';
import { coarsePlace, type FindCandidate } from '../find/catalog.js';
import { targetPathForItem, uidForItem } from './addressing.js';
import { slidesForItem } from './indexer.js';
import type { IndexFile, IndexedElement } from './types.js';

export const PPTX_FIND_KINDS = [
  'shape',
  'textbox',
  'picture',
  'chart',
  'table',
  'connector',
  'group',
  'notes',
] as const;

const themePart = (partUri: string): boolean =>
  partUri.startsWith('/ppt/slideMasters/') ||
  partUri.startsWith('/ppt/slideLayouts/') ||
  partUri.startsWith('/ppt/theme/');

const textPart = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const describeIndexed = (item: IndexedElement): string | undefined => {
  const parts: string[] = [];
  const push = (value: string | undefined): void => {
    if (value && !parts.includes(value)) parts.push(value);
  };
  push(item.text);
  const payload = item.payload;
  push(textPart(payload?.['title']));
  const series = payload?.['series'];
  if (Array.isArray(series)) {
    const names = series
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return undefined;
        return textPart((entry as Record<string, unknown>)['name']);
      })
      .filter((name): name is string => name !== undefined);
    if (names.length > 0) push(names.join(', '));
  }
  const placeholder = textPart(payload?.['placeholder']);
  if (placeholder) push(`placeholder ${placeholder}`);
  push(textPart(payload?.['fileName']));
  return parts.length > 0 ? parts.join(' | ') : undefined;
};

export const collectPptxFindCandidates = (
  index: IndexFile,
  command: Pick<Extract<Command, { type: 'find' }>, 'slide' | 'kind'>,
): FindCandidate[] => {
  const kinds = new Set<string>(command.kind ?? PPTX_FIND_KINDS);
  const allowThemeParts = kinds.has('master') || kinds.has('layout') || kinds.has('theme');
  const candidates: FindCandidate[] = [];
  for (const item of index.elements) {
    if (!kinds.has(item.kind)) continue;
    if (!allowThemeParts && themePart(item.partUri)) continue;
    const page = slidesForItem(index, item)[0];
    if (command.slide !== undefined && page !== command.slide) continue;
    const text = describeIndexed(item);
    const place = coarsePlace(item.transform);
    candidates.push({
      target: targetPathForItem(index, item),
      uid: uidForItem(item),
      kind: item.kind,
      container: page !== undefined ? `slide ${String(page)}` : 'deck',
      context: item.partUri,
      ...(item.name ? { name: item.name } : {}),
      ...(text ? { text } : {}),
      ...(item.text ? { matchText: item.text } : {}),
      ...(page !== undefined ? { slide: page } : {}),
      ...(place ? { place } : {}),
    });
  }
  return candidates;
};
