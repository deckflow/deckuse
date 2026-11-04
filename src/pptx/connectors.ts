import type { Document, Element } from '@xmldom/xmldom';
import { NS, descendants, first, children, cNvPr } from './xml.js';
import { readBBox, writeBBox } from './align.js';
import { requireDefined as need } from '../required.js';
import { resolveTarget } from './addressing.js';
import type { IndexFile } from './types.js';
import { nodeFor } from './node-for.js';
export function connectionSites(node: Element): { x: number; y: number }[] {
  need(readBBox(node));
  const geom = first(node, 'custGeom');
  if (geom) {
    const cxns = children(need(first(geom, 'cxnLst')));
    return cxns.map((c) => {
      const p = need(first(c, 'pos'));
      const resolve = (key: 'x' | 'y') => {
        const guide = children(need(first(geom, 'gdLst'))).find(
          (g) => g.getAttribute('name') === p.getAttribute(key),
        );
        const formula = guide?.getAttribute('fmla');
        const match = /^\*\/ [wh] (-?\d+) 100000$/.exec(formula ?? '');
        if (!match) throw new Error('CONNECTOR_CUSTOM_SITE_EXPRESSION_UNSUPPORTED');
        return Number(match[1]) / 100000;
      };
      return { x: resolve('x'), y: resolve('y') };
    });
  }
  const preset = first(node, 'prstGeom')?.getAttribute('prst');
  // These presets share the DrawingML top/left/bottom/right connection-site order.
  if (!['rect', 'roundRect', 'ellipse', 'diamond'].includes(preset ?? ''))
    throw new Error('CONNECTOR_TARGET_GEOMETRY_UNSUPPORTED');
  return [
    { x: 0.5, y: 0 },
    { x: 0, y: 0.5 },
    { x: 0.5, y: 1 },
    { x: 1, y: 0.5 },
  ];
}
function transformPoint(node: Element, point: { x: number; y: number }, group = false) {
  const b = need(readBBox(node)),
    xf = need(first(node, 'xfrm'));
  let x = point.x,
    y = point.y;
  if (group) {
    const off = need(first(xf, 'chOff')),
      ext = need(first(xf, 'chExt'));
    x = (x - Number(off.getAttribute('x'))) / Number(ext.getAttribute('cx'));
    y = (y - Number(off.getAttribute('y'))) / Number(ext.getAttribute('cy'));
  }
  if (xf.getAttribute('flipH') === '1') x = 1 - x;
  if (xf.getAttribute('flipV') === '1') y = 1 - y;
  const a = (Number(xf.getAttribute('rot') ?? 0) * Math.PI) / 10800000,
    dx = (x - 0.5) * b.width,
    dy = (y - 0.5) * b.height;
  return {
    x: b.x + b.width / 2 + dx * Math.cos(a) - dy * Math.sin(a),
    y: b.y + b.height / 2 + dx * Math.sin(a) + dy * Math.cos(a),
  };
}
function globalSite(node: Element, site: number) {
  const point = connectionSites(node)[site];
  if (!point) throw new Error('CONNECTOR_SITE_OUT_OF_RANGE');
  let p = transformPoint(node, point),
    parent = node.parentNode as Element | null;
  while (parent?.localName === 'grpSp') {
    p = transformPoint(parent, p, true);
    parent = parent.parentNode as Element | null;
  }
  return p;
}
function localPoint(parent: Element, p: { x: number; y: number }): { x: number; y: number } {
  if (parent.localName !== 'grpSp') return p;
  const outer = localPoint(parent.parentNode as Element, p),
    b = need(readBBox(parent)),
    xf = need(first(parent, 'xfrm')),
    off = need(first(xf, 'chOff')),
    ext = need(first(xf, 'chExt'));
  const a = (-Number(xf.getAttribute('rot') ?? 0) * Math.PI) / 10800000,
    dx = outer.x - b.x - b.width / 2,
    dy = outer.y - b.y - b.height / 2;
  let x = (dx * Math.cos(a) - dy * Math.sin(a)) / b.width + 0.5,
    y = (dx * Math.sin(a) + dy * Math.cos(a)) / b.height + 0.5;
  if (xf.getAttribute('flipH') === '1') x = 1 - x;
  if (xf.getAttribute('flipV') === '1') y = 1 - y;
  return {
    x: Number(off.getAttribute('x')) + x * Number(ext.getAttribute('cx')),
    y: Number(off.getAttribute('y')) + y * Number(ext.getAttribute('cy')),
  };
}
export function bindConnector(
  doc: Document,
  node: Element,
  properties: Record<string, unknown>,
  index: IndexFile,
  part: string,
) {
  if (!['start', 'end', 'routing'].some((k) => k in properties)) return;
  if (node.localName !== 'cxnSp') throw new Error('CONNECTOR_BINDING_REQUIRES_CONNECTOR');
  const geometry = first(node, 'prstGeom');
  if (geometry?.getAttribute('prst') === 'line' && ('start' in properties || 'end' in properties))
    geometry.setAttribute('prst', 'straightConnector1');
  const nv = need(first(node, 'cNvCxnSpPr'));
  for (const [key, tag] of [
    ['start', 'stCxn'],
    ['end', 'endCxn'],
  ] as const) {
    if (!(key in properties)) continue;
    const value = properties[key];
    let existing = children(nv).find((n) => n.localName === tag);
    if (value === null) {
      if (existing) nv.removeChild(existing);
      continue;
    }
    if (!value || typeof value !== 'object') throw new Error('CONNECTOR_INVALID_ENDPOINT');
    const v = value as Record<string, unknown>;
    if (typeof v['target'] !== 'string' || !Number.isInteger(v['site']))
      throw new Error('CONNECTOR_INVALID_ENDPOINT');
    const r = resolveTarget(index, v['target']);
    if (!r.ok) throw new Error(r.error.message);
    if (r.value.item.partUri !== part) throw new Error('CONNECTOR_CROSS_SLIDE');
    const target = need(nodeFor(doc, r.value.item));
    if (target === node || target.localName !== 'sp')
      throw new Error('CONNECTOR_TARGET_UNSUPPORTED');
    globalSite(target, Number(v['site']));
    if (!existing) {
      existing = doc.createElementNS(NS.a, `a:${tag}`);
      nv.insertBefore(existing, children(nv).find((n) => n.localName === 'extLst') ?? null);
    }
    existing.setAttribute('id', need(cNvPr(target)).getAttribute('id') ?? '');
    existing.setAttribute('idx', String(v['site']));
  }
  if (
    properties['routing'] !== undefined &&
    !['auto', 'preserve'].includes(
      typeof properties['routing'] === 'string' ? properties['routing'] : '',
    )
  )
    throw new Error('CONNECTOR_ROUTING_INVALID');
  let list = children(nv).find((n) => n.localName === 'extLst');
  if (!list) {
    list = doc.createElementNS(NS.a, 'a:extLst');
    nv.appendChild(list);
  }
  let ext = children(list).find(
    (n) => n.getAttribute('uri') === '{44097892-8496-48EB-AF33-173A3E7E17C1}',
  );
  if (!ext) {
    ext = doc.createElementNS(NS.a, 'a:ext');
    ext.setAttribute('uri', '{44097892-8496-48EB-AF33-173A3E7E17C1}');
    list.appendChild(ext);
    const route = doc.createElementNS('https://deckuse.dev/connector/1', 'du:routing');
    route.setAttribute('val', 'auto');
    ext.appendChild(route);
  }
  const routing = need(children(ext)[0]);
  if (properties['routing'] !== undefined)
    routing.setAttribute(
      'val',
      typeof properties['routing'] === 'string' ? properties['routing'] : 'auto',
    );
  if (routing.getAttribute('val') !== 'preserve') {
    const preset = first(node, 'prstGeom')?.getAttribute('prst');
    if (preset === 'line' || preset === 'straightConnector1' || preset === 'bentConnector3') {
      const adjustments = first(node, 'avLst');
      if (adjustments) for (const child of children(adjustments)) adjustments.removeChild(child);
    }
  }
}
export const affectedShapeIds = (node: Element) =>
  new Set(descendants(node, 'cNvPr').map((n) => n.getAttribute('id') ?? ''));
export function refreshConnectors(
  doc: Document,
  deletedPolicy = 'detach',
  changedIds?: Set<string>,
) {
  const nodes = descendants(doc).filter((n) =>
    ['sp', 'pic', 'grpSp', 'cxnSp', 'graphicFrame'].includes(n.localName ?? ''),
  );
  const byId = new Map(nodes.map((n) => [cNvPr(n)?.getAttribute('id'), n]));
  const detached: string[] = [];
  for (const connector of nodes.filter((n) => n.localName === 'cxnSp')) {
    const connectorId = cNvPr(connector)?.getAttribute('id') ?? '';
    if (
      changedIds &&
      !changedIds.has(connectorId) &&
      !['stCxn', 'endCxn'].some((tag) => {
        const ref = first(connector, tag);
        return ref && changedIds.has(ref.getAttribute('id') ?? '');
      })
    )
      continue;
    const route = descendants(connector, 'routing')
      .find((n) => n.namespaceURI === 'https://deckuse.dev/connector/1')
      ?.getAttribute('val');
    if (route === 'auto') {
      const preset = first(connector, 'prstGeom')?.getAttribute('prst');
      if (preset === 'line' || preset === 'straightConnector1' || preset === 'bentConnector3') {
        const adjustments = first(connector, 'avLst');
        if (adjustments) for (const child of children(adjustments)) adjustments.removeChild(child);
      }
    }
    const xf = need(first(connector, 'xfrm'));
    let start = transformPoint(connector, { x: 0, y: 0 }),
      end = transformPoint(connector, { x: 1, y: 1 });
    for (const [tag, key] of [
      ['stCxn', 'start'],
      ['endCxn', 'end'],
    ] as const) {
      const ref = first(connector, tag);
      if (!ref) continue;
      const target = byId.get(ref.getAttribute('id'));
      if (!target) {
        if (deletedPolicy === 'reject') throw new Error('CONNECTOR_NODE_IN_USE');
        need(ref.parentNode).removeChild(ref);
        detached.push(need(cNvPr(connector)).getAttribute('id') ?? '');
        continue;
      }
      let point: { x: number; y: number };
      try {
        point = globalSite(target, Number(ref.getAttribute('idx')));
      } catch (cause) {
        if (
          changedIds &&
          !changedIds.has(ref.getAttribute('id') ?? '') &&
          !changedIds.has(connectorId)
        )
          continue;
        throw cause;
      }
      const p = localPoint(connector.parentNode as Element, point);
      if (key === 'start') start = p;
      else end = p;
    }
    if (!first(connector, 'stCxn') && !first(connector, 'endCxn')) continue;
    writeBBox(connector, {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    });
    xf.setAttribute('rot', '0');
    xf.setAttribute('flipH', start.x > end.x ? '1' : '0');
    xf.setAttribute('flipV', start.y > end.y ? '1' : '0');
  }
  return detached;
}
