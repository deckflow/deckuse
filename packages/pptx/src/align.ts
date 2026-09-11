import { parseLength, type LengthInput } from '@deckflow/deckuse-core';
import type { Element } from '@xmldom/xmldom';
import { attr, first } from './xml.js';
import type { LengthContext } from '@deckflow/deckuse-core';

export interface ShapeBBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly node: Element;
}

export type AlignMode =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'center-h'
  | 'center-v'
  | 'distribute-h'
  | 'distribute-v';

export function readBBox(node: Element): ShapeBBox | undefined {
  const xfrm = first(node, 'xfrm');
  if (!xfrm) return undefined;
  const off = first(xfrm, 'off');
  const ext = first(xfrm, 'ext');
  const x = Number(attr(off, 'x') ?? 0);
  const y = Number(attr(off, 'y') ?? 0);
  const width = Number(attr(ext, 'cx') ?? 0);
  const height = Number(attr(ext, 'cy') ?? 0);
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return undefined;
  return { x, y, width, height, node };
}

export function writeBBox(node: Element, box: { x?: number; y?: number; width?: number; height?: number }): void {
  const xfrm = first(node, 'xfrm');
  if (!xfrm) throw new Error('Shape has no xfrm');
  const off = first(xfrm, 'off');
  const ext = first(xfrm, 'ext');
  if (!off || !ext) throw new Error('Shape xfrm missing off/ext');
  if (box.x !== undefined) off.setAttribute('x', String(Math.round(box.x)));
  if (box.y !== undefined) off.setAttribute('y', String(Math.round(box.y)));
  if (box.width !== undefined) ext.setAttribute('cx', String(Math.round(box.width)));
  if (box.height !== undefined) ext.setAttribute('cy', String(Math.round(box.height)));
}

export function computeAlignUpdates(
  boxes: ShapeBBox[],
  mode: AlignMode,
  gap: LengthInput | undefined,
  lengthContext: LengthContext,
): Array<{ node: Element; x?: number; y?: number }> {
  if (boxes.length === 0) return [];
  const gapEmu =
    gap !== undefined
      ? parseLength(gap, { ...lengthContext, axis: mode.includes('v') ? 'y' : 'x' })
      : undefined;

  const minX = Math.min(...boxes.map((b) => b.x));
  const maxRight = Math.max(...boxes.map((b) => b.x + b.width));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxBottom = Math.max(...boxes.map((b) => b.y + b.height));
  const centerX = (minX + maxRight) / 2;
  const centerY = (minY + maxBottom) / 2;

  if (mode === 'left') return boxes.map((b) => ({ node: b.node, x: minX }));
  if (mode === 'right') return boxes.map((b) => ({ node: b.node, x: maxRight - b.width }));
  if (mode === 'top') return boxes.map((b) => ({ node: b.node, y: minY }));
  if (mode === 'bottom') return boxes.map((b) => ({ node: b.node, y: maxBottom - b.height }));
  if (mode === 'center-h') return boxes.map((b) => ({ node: b.node, x: centerX - b.width / 2 }));
  if (mode === 'center-v') return boxes.map((b) => ({ node: b.node, y: centerY - b.height / 2 }));

  if (mode === 'distribute-h') {
    const ordered = [...boxes].sort((a, b) => a.x - b.x);
    if (ordered.length === 1) return [];
    if (gapEmu !== undefined) {
      let cursor = ordered[0]!.x;
      return ordered.map((b, i) => {
        if (i === 0) {
          cursor = b.x + b.width + gapEmu;
          return { node: b.node };
        }
        const x = cursor;
        cursor = x + b.width + gapEmu;
        return { node: b.node, x };
      });
    }
    const totalWidth = ordered.reduce((sum, b) => sum + b.width, 0);
    const span = maxRight - minX;
    const free = span - totalWidth;
    const step = free / (ordered.length - 1);
    let cursor = minX;
    return ordered.map((b) => {
      const x = cursor;
      cursor += b.width + step;
      return { node: b.node, x };
    });
  }

  // distribute-v
  const ordered = [...boxes].sort((a, b) => a.y - b.y);
  if (ordered.length === 1) return [];
  if (gapEmu !== undefined) {
    let cursor = ordered[0]!.y;
    return ordered.map((b, i) => {
      if (i === 0) {
        cursor = b.y + b.height + gapEmu;
        return { node: b.node };
      }
      const y = cursor;
      cursor = y + b.height + gapEmu;
      return { node: b.node, y };
    });
  }
  const totalHeight = ordered.reduce((sum, b) => sum + b.height, 0);
  const span = maxBottom - minY;
  const free = span - totalHeight;
  const step = free / (ordered.length - 1);
  let cursor = minY;
  return ordered.map((b) => {
    const y = cursor;
    cursor += b.height + step;
    return { node: b.node, y };
  });
}
