import type { Command } from '../core/index.js';
import { FIND_CHUNK_SIZE, type FindCandidate } from '../find/catalog.js';
import type { IndexFile } from './types.js';

export const DOCX_FIND_KINDS = ['paragraph', 'table', 'bookmark'] as const;

export const collectDocxFindCandidates = (
  index: IndexFile,
  command: Pick<Extract<Command, { type: 'find' }>, 'kind'>,
): FindCandidate[] => {
  const kinds = new Set<string>(command.kind ?? DOCX_FIND_KINDS);
  const selected = index.elements.filter((item) => kinds.has(item.kind));
  return selected.map((item, indexInKind) => ({
    target: item.ref.path ?? item.ref.elementId ?? 'unknown',
    kind: item.kind,
    container: `section ${String(Math.floor(indexInKind / FIND_CHUNK_SIZE) + 1)}`,
    ...(item.ref.elementId ? { uid: item.ref.elementId } : {}),
    ...(item.name ? { name: item.name } : {}),
    ...(item.text ? { text: item.text, matchText: item.text } : {}),
  }));
};
