import type { Document } from '@xmldom/xmldom';
import { pathGeometrySchema } from '../core/schema.js';
import { requireDefined as need } from '../required.js';
import { NS, first, children } from './xml.js';
export function customGeometry(doc: Document, input: unknown) {
  const g = pathGeometrySchema.parse(input),
    geom = doc.createElementNS(NS.a, 'a:custGeom');
  const el = (name: string, attrs: Record<string, string | number> = {}) => {
    const n = doc.createElementNS(NS.a, `a:${name}`);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };
  geom.appendChild(el('avLst'));
  const guides = el('gdLst');
  geom.appendChild(guides);
  const quantize = (value: number, size: number) => {
    const normalized = Math.round((value / size) * 100000);
    if (!Number.isSafeInteger(normalized)) throw new Error('PATH_COORDINATE_OUT_OF_RANGE');
    return normalized;
  };
  geom.appendChild(el('ahLst'));
  const cxns = el('cxnLst');
  for (const [index, point] of (g.connectionPoints ?? []).entries()) {
    const x = `cx${String(index)}`,
      y = `cy${String(index)}`;
    guides.appendChild(
      el('gd', { name: x, fmla: `*/ w ${String(quantize(point.x, g.viewBox.width))} 100000` }),
    );
    guides.appendChild(
      el('gd', { name: y, fmla: `*/ h ${String(quantize(point.y, g.viewBox.height))} 100000` }),
    );
    const cxn = el('cxn', { ang: Math.round((((point.angle % 360) + 360) % 360) * 60000) });
    cxn.appendChild(el('pos', { x, y }));
    cxns.appendChild(cxn);
  }
  geom.appendChild(cxns);
  geom.appendChild(el('rect', { l: 0, t: 0, r: 'r', b: 'b' }));
  const list = el('pathLst');
  for (const commands of g.paths) {
    const path = el('path', { w: 100000, h: 100000 });
    const point = (x: number, y: number) =>
      el('pt', {
        x: quantize(x, g.viewBox.width),
        y: quantize(y, g.viewBox.height),
      });
    for (const c of commands) {
      const n = el(
        c.type === 'move'
          ? 'moveTo'
          : c.type === 'line'
            ? 'lnTo'
            : c.type === 'cubic'
              ? 'cubicBezTo'
              : 'close',
      );
      if (c.type === 'cubic') {
        n.appendChild(point(c.x1, c.y1));
        n.appendChild(point(c.x2, c.y2));
      }
      if (c.type !== 'close') n.appendChild(point(c.x, c.y));
      path.appendChild(n);
    }
    list.appendChild(path);
  }
  geom.appendChild(list);
  return geom;
}

export function readCustomGeometry(node: import('@xmldom/xmldom').Element) {
  const geom = first(node, 'custGeom');
  if (!geom) return undefined;
  if (
    !first(geom, 'pathLst') ||
    children(need(first(geom, 'pathLst'))).some(
      (p) =>
        p.getAttribute('w') !== '100000' ||
        p.getAttribute('h') !== '100000' ||
        children(p).some(
          (c) => !['moveTo', 'lnTo', 'cubicBezTo', 'close'].includes(c.localName ?? ''),
        ),
    )
  )
    return {
      editable: false,
      reason: 'Existing custom geometry uses unsupported commands or coordinate space',
    };
  return {
    viewBox: { width: 100000, height: 100000 },
    paths: children(need(first(geom, 'pathLst'))).map((path) =>
      children(path).map((cmd) => {
        const points = children(cmd).map((p) => ({
          x: Number(p.getAttribute('x')),
          y: Number(p.getAttribute('y')),
        }));
        if (cmd.localName === 'close') return { type: 'close' };
        if (cmd.localName === 'cubicBezTo')
          return {
            type: 'cubic',
            x1: points[0]?.x,
            y1: points[0]?.y,
            x2: points[1]?.x,
            y2: points[1]?.y,
            x: points[2]?.x,
            y: points[2]?.y,
          };
        return { type: cmd.localName === 'moveTo' ? 'move' : 'line', ...points[0] };
      }),
    ),
  };
}
