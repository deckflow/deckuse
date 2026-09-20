import { err, ok, type Result } from '@deckflow/deckuse-core';

export type TargetKind =
  'body' | 'paragraph' | 'run' | 'table' | 'cell' | 'paraId' | 'bookmark' | 'style' | 'section';

export interface ParsedTarget {
  raw: string;
  kind: TargetKind;
  paragraph?: number;
  run?: number;
  table?: number;
  row?: number;
  cell?: number;
  cellParagraph?: number;
  paraId?: string;
  bookmark?: string;
  style?: string;
  section?: number;
}

const HINT =
  'Use body/p:<n>, body/p:<n>/run:<k>, para:<paraId>, bookmark:<name>, body/table:<n>/row:<r>/cell:<c>/p:<n>, style:<id>, or section:<n>.';

const indexToken = (token: string, prefix: string, min: number): number | undefined => {
  if (!token.startsWith(prefix)) return undefined;
  const raw = token.slice(prefix.length);
  if (!/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) return undefined;
  return value;
};

export function parseTargetPath(raw: string): Result<ParsedTarget> {
  const trimmed = raw.trim();
  if (!trimmed) return err('INVALID_COMMAND', 'Target path is empty');
  if (trimmed === 'body') return ok({ raw: trimmed, kind: 'body' });

  if (trimmed.startsWith('para:')) {
    const paraId = trimmed.slice('para:'.length).toUpperCase();
    if (!/^[0-9A-F]{8}$/.test(paraId)) {
      return err('INVALID_COMMAND', `Invalid paraId in target: ${trimmed}`, [], {
        target: trimmed,
        hint: 'para: expects the 8-digit w14:paraId.',
      });
    }
    return ok({ raw: trimmed, kind: 'paraId', paraId });
  }
  if (trimmed.startsWith('bookmark:')) {
    const bookmark = trimmed.slice('bookmark:'.length);
    if (!bookmark)
      return err('INVALID_COMMAND', `Missing bookmark name in target: ${trimmed}`, [], {
        target: trimmed,
      });
    return ok({ raw: trimmed, kind: 'bookmark', bookmark });
  }
  if (trimmed.startsWith('style:')) {
    const style = trimmed.slice('style:'.length);
    if (!style)
      return err('INVALID_COMMAND', `Missing style id in target: ${trimmed}`, [], {
        target: trimmed,
      });
    return ok({ raw: trimmed, kind: 'style', style });
  }
  if (trimmed.startsWith('section:')) {
    const section = indexToken(trimmed, 'section:', 1);
    if (section === undefined)
      return err('INVALID_COMMAND', `Invalid section in target: ${trimmed}`, [], {
        target: trimmed,
      });
    return ok({ raw: trimmed, kind: 'section', section });
  }
  if (!trimmed.startsWith('body/')) {
    return err('INVALID_COMMAND', `Unrecognized target path: ${trimmed}`, [], {
      target: trimmed,
      hint: HINT,
    });
  }

  const segments = trimmed.split('/');
  const second = segments[1] ?? '';
  const paragraph = indexToken(second, 'p:', 1);
  if (paragraph !== undefined) {
    const parsed: ParsedTarget = { raw: trimmed, kind: 'paragraph', paragraph };
    if (segments.length === 2) return ok(parsed);
    const run = indexToken(segments[2] ?? '', 'run:', 0);
    if (run === undefined || segments.length !== 3)
      return err('INVALID_COMMAND', `Unrecognized target path: ${trimmed}`, [], {
        target: trimmed,
        hint: HINT,
      });
    return ok({ ...parsed, kind: 'run', run });
  }

  const table = indexToken(second, 'table:', 1);
  if (table === undefined)
    return err('INVALID_COMMAND', `Unrecognized target path: ${trimmed}`, [], {
      target: trimmed,
      hint: HINT,
    });
  const parsed: ParsedTarget = { raw: trimmed, kind: 'table', table };
  if (segments.length === 2) return ok(parsed);
  const row = indexToken(segments[2] ?? '', 'row:', 1);
  const cell = indexToken(segments[3] ?? '', 'cell:', 1);
  if (row === undefined || cell === undefined)
    return err('INVALID_COMMAND', `Unrecognized target path: ${trimmed}`, [], {
      target: trimmed,
      hint: HINT,
    });
  const withCell: ParsedTarget = { ...parsed, kind: 'cell', row, cell };
  if (segments.length === 4) return ok(withCell);
  const cellParagraph = indexToken(segments[4] ?? '', 'p:', 1);
  if (cellParagraph === undefined)
    return err('INVALID_COMMAND', `Unrecognized target path: ${trimmed}`, [], {
      target: trimmed,
      hint: HINT,
    });
  const inCell: ParsedTarget = { ...withCell, kind: 'paragraph', cellParagraph };
  if (segments.length === 5) return ok(inCell);
  const run = indexToken(segments[5] ?? '', 'run:', 0);
  if (run === undefined || segments.length !== 6)
    return err('INVALID_COMMAND', `Unrecognized target path: ${trimmed}`, [], {
      target: trimmed,
      hint: HINT,
    });
  return ok({ ...inCell, kind: 'run', run });
}
