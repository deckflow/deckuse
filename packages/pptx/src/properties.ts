import { err, ok, type Result } from '@deckflow/deckuse-core';
import type { Element } from '@xmldom/xmldom';
import { setColor } from './elements.js';
import { NS, children, descendants, first, setNodeText } from './xml.js';

const STROKE_ALIASES = ['stroke', 'border', 'outline', 'line'] as const;
const FONT_FAMILY_ALIASES = ['fontFamily', 'font', 'typeface'] as const;
const FONT_SIZE_ALIASES = ['fontSize', 'size'] as const;
const TEXT_COLOR_ALIASES = ['textColor', 'fontColor'] as const;

const SHAPE_KEYS = new Set([
  'text',
  'name',
  'color',
  'from',
  'fill',
  'hidden',
  'bold',
  'italic',
  'underline',
  ...STROKE_ALIASES,
  ...FONT_FAMILY_ALIASES,
  ...FONT_SIZE_ALIASES,
  ...TEXT_COLOR_ALIASES,
]);

const CHART_KEYS = new Set(['title', 'series', 'text']);

const EMU_PER_PT = 12700;
const DEFAULT_STROKE_PT = 1;

const normalizeColor = (value: string): string => {
  const hex = value.trim().replace(/^#/, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(hex)) throw new Error(`Invalid color: ${value}`);
  return hex;
};

const isNone = (value: unknown): boolean => {
  if (value === null || value === false || value === 'none') return true;
  return (
    typeof value === 'object' && 'type' in value && (value as { type?: unknown }).type === 'none'
  );
};

const pickAlias = <T extends string>(
  properties: Record<string, unknown>,
  aliases: readonly T[],
): { key: T; value: unknown } | undefined => {
  for (const key of aliases) if (key in properties) return { key, value: properties[key] };
  return undefined;
};

const directChild = (node: Element, localName: string): Element | undefined =>
  children(node).find((child) => child.localName === localName);

const removeDirectChildren = (node: Element, localNames: readonly string[]): void => {
  for (const child of [...children(node)])
    if (child.localName && localNames.includes(child.localName)) node.removeChild(child);
};

const insertAfter = (parent: Element, node: Element, afterLocalNames: readonly string[]): void => {
  const kids = children(parent);
  let anchor: Element | undefined;
  for (const child of kids)
    if (child.localName && afterLocalNames.includes(child.localName)) anchor = child;
  if (anchor?.nextSibling) parent.insertBefore(node, anchor.nextSibling);
  else if (anchor) parent.appendChild(node);
  else if (kids[0]) parent.insertBefore(node, kids[0]);
  else parent.appendChild(node);
};

const ensureSpPr = (node: Element): Element => {
  const existing = directChild(node, 'spPr');
  if (existing) return existing;
  const doc = node.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  const prefix = node.prefix ? `${node.prefix}:` : 'p:';
  const spPr = doc.createElementNS(NS.p, `${prefix}spPr`);
  const after = children(node).find((child) => child.localName?.startsWith('nv'));
  if (after?.nextSibling) node.insertBefore(spPr, after.nextSibling);
  else if (after) node.appendChild(spPr);
  else if (node.firstChild) node.insertBefore(spPr, node.firstChild);
  else node.appendChild(spPr);
  return spPr;
};

const solidFillXml = (doc: NonNullable<Element['ownerDocument']>, color: string): Element => {
  const solidFill = doc.createElementNS(NS.a, 'a:solidFill');
  const srgb = doc.createElementNS(NS.a, 'a:srgbClr');
  srgb.setAttribute('val', color);
  solidFill.appendChild(srgb);
  return solidFill;
};

const FILL_LOCAL_NAMES = [
  'noFill',
  'solidFill',
  'gradFill',
  'blipFill',
  'pattFill',
  'grpFill',
] as const;

const setFill = (spPr: Element, value: unknown): void => {
  const doc = spPr.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  removeDirectChildren(spPr, FILL_LOCAL_NAMES);
  if (isNone(value)) {
    insertAfter(spPr, doc.createElementNS(NS.a, 'a:noFill'), ['xfrm', 'prstGeom', 'custGeom']);
    return;
  }
  let color: string | undefined;
  if (typeof value === 'string') color = normalizeColor(value);
  else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (record['type'] === 'solid' || record['color'] !== undefined) {
      if (typeof record['color'] !== 'string') throw new Error('fill.color must be a hex string');
      color = normalizeColor(record['color']);
    } else throw new Error('Unsupported fill value');
  } else throw new Error('Unsupported fill value');
  insertAfter(spPr, solidFillXml(doc, color), ['xfrm', 'prstGeom', 'custGeom']);
};

const setStroke = (spPr: Element, value: unknown): void => {
  const doc = spPr.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  removeDirectChildren(spPr, ['ln']);
  if (isNone(value)) {
    const ln = doc.createElementNS(NS.a, 'a:ln');
    ln.appendChild(doc.createElementNS(NS.a, 'a:noFill'));
    insertAfter(spPr, ln, ['xfrm', 'prstGeom', 'custGeom', ...FILL_LOCAL_NAMES]);
    return;
  }
  let color = '0000FF';
  let widthPt = DEFAULT_STROKE_PT;
  let dash: string | undefined;
  if (typeof value === 'string') color = normalizeColor(value);
  else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record['color'] === 'string') color = normalizeColor(record['color']);
    else if (record['color'] !== undefined) throw new Error('stroke.color must be a hex string');
    const width = record['width'] ?? record['widthPt'];
    if (typeof width === 'number' && Number.isFinite(width) && width > 0) widthPt = width;
    else if (width !== undefined) throw new Error('stroke.width must be a positive number (pt)');
    if (typeof record['dash'] === 'string') dash = record['dash'];
    else if (record['dash'] !== undefined) throw new Error('stroke.dash must be a string');
  } else throw new Error('Unsupported stroke value');

  const ln = doc.createElementNS(NS.a, 'a:ln');
  ln.setAttribute('w', String(Math.round(widthPt * EMU_PER_PT)));
  ln.appendChild(solidFillXml(doc, color));
  if (dash) {
    const prstDash = doc.createElementNS(NS.a, 'a:prstDash');
    prstDash.setAttribute('val', dash);
    ln.appendChild(prstDash);
  }
  insertAfter(spPr, ln, ['xfrm', 'prstGeom', 'custGeom', ...FILL_LOCAL_NAMES]);
};

const runPropertyTargets = (node: Element): Element[] => {
  const doc = node.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  const targets: Element[] = [];
  for (const run of descendants(node, 'r')) {
    // Skip non-text runs that are not under DrawingML text (still OK for ppt shapes).
    let rPr = directChild(run, 'rPr');
    if (!rPr) {
      rPr = doc.createElementNS(NS.a, 'a:rPr');
      if (run.firstChild) run.insertBefore(rPr, run.firstChild);
      else run.appendChild(rPr);
    }
    targets.push(rPr);
  }
  return targets;
};

const setTextColor = (rPr: Element, color: string): void => {
  const doc = rPr.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  removeDirectChildren(rPr, FILL_LOCAL_NAMES);
  if (rPr.firstChild) rPr.insertBefore(solidFillXml(doc, color), rPr.firstChild);
  else rPr.appendChild(solidFillXml(doc, color));
};

const setFontFamily = (rPr: Element, family: string): void => {
  const doc = rPr.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  for (const kind of ['latin', 'ea', 'cs'] as const) {
    let node = directChild(rPr, kind);
    if (!node) {
      node = doc.createElementNS(NS.a, `a:${kind}`);
      rPr.appendChild(node);
    }
    node.setAttribute('typeface', family);
  }
};

const setBooleanAttr = (el: Element, name: string, value: boolean): void => {
  if (value) el.setAttribute(name, '1');
  else el.removeAttribute(name);
};

const setHidden = (node: Element, hidden: boolean): void => {
  const doc = node.ownerDocument;
  if (!doc) throw new Error('Element has no document');
  const existing = directChild(node, 'nvPr') ?? first(node, 'nvPr');
  const nvPr =
    existing ??
    (() => {
      const created = doc.createElementNS(NS.p, 'p:nvPr');
      const container =
        directChild(node, 'nvSpPr') ??
        directChild(node, 'nvPicPr') ??
        directChild(node, 'nvCxnSpPr') ??
        directChild(node, 'nvGraphicFramePr');
      if (container) container.appendChild(created);
      else node.appendChild(created);
      return created;
    })();
  if (hidden) nvPr.setAttribute('hidden', '1');
  else nvPr.removeAttribute('hidden');
};

const unknownKeys = (properties: Record<string, unknown>, allowed: Set<string>): string[] =>
  Object.keys(properties).filter((key) => !allowed.has(key));

export function applyShapeProperties(
  node: Element,
  properties: Record<string, unknown>,
): Result<{ applied: string[] }> {
  const unexpected = unknownKeys(properties, SHAPE_KEYS);
  if (unexpected.length)
    return err('INVALID_COMMAND', `Unsupported setProperties keys: ${unexpected.join(', ')}`);

  const applied: string[] = [];
  try {
    if (typeof properties['text'] === 'string') {
      setNodeText(node, properties['text']);
      applied.push('text');
    } else if (properties['text'] !== undefined) throw new Error('text must be a string');

    if (typeof properties['name'] === 'string') {
      const pr = first(node, 'cNvPr');
      if (!pr) throw new Error('Element has no cNvPr to set name');
      pr.setAttribute('name', properties['name']);
      applied.push('name');
    } else if (properties['name'] !== undefined) throw new Error('name must be a string');

    if (typeof properties['color'] === 'string') {
      const fromRaw = properties['from'];
      if (fromRaw !== undefined && typeof fromRaw !== 'string')
        throw new Error('from must be a hex string');
      const from = typeof fromRaw === 'string' ? fromRaw : '';
      setColor(node, from, properties['color']);
      applied.push('color');
    } else if (properties['color'] !== undefined) throw new Error('color must be a hex string');
    else if (properties['from'] !== undefined) throw new Error('from requires color');

    if ('fill' in properties) {
      setFill(ensureSpPr(node), properties['fill']);
      applied.push('fill');
    }

    const stroke = pickAlias(properties, STROKE_ALIASES);
    if (stroke) {
      const conflicts = STROKE_ALIASES.filter((key) => key in properties);
      if (conflicts.length > 1)
        throw new Error(`Use only one stroke alias; found: ${conflicts.join(', ')}`);
      setStroke(ensureSpPr(node), stroke.value);
      applied.push(stroke.key);
    }

    const needsRunProps =
      TEXT_COLOR_ALIASES.some((key) => key in properties) ||
      FONT_FAMILY_ALIASES.some((key) => key in properties) ||
      FONT_SIZE_ALIASES.some((key) => key in properties) ||
      'bold' in properties ||
      'italic' in properties ||
      'underline' in properties;

    if (needsRunProps) {
      const rPrs = runPropertyTargets(node);
      if (rPrs.length === 0) throw new Error('Element has no text runs to style');

      const textColor = pickAlias(properties, TEXT_COLOR_ALIASES);
      if (textColor) {
        if (typeof textColor.value !== 'string') throw new Error('textColor must be a hex string');
        const color = normalizeColor(textColor.value);
        for (const rPr of rPrs) setTextColor(rPr, color);
        applied.push(textColor.key);
      }

      const fontFamily = pickAlias(properties, FONT_FAMILY_ALIASES);
      if (fontFamily) {
        if (typeof fontFamily.value !== 'string' || !fontFamily.value)
          throw new Error('fontFamily must be a non-empty string');
        for (const rPr of rPrs) setFontFamily(rPr, fontFamily.value);
        applied.push(fontFamily.key);
      }

      const fontSize = pickAlias(properties, FONT_SIZE_ALIASES);
      if (fontSize) {
        if (typeof fontSize.value !== 'number' || !(fontSize.value > 0))
          throw new Error('fontSize must be a positive number (pt)');
        const sz = String(Math.round(fontSize.value * 100));
        for (const rPr of rPrs) rPr.setAttribute('sz', sz);
        applied.push(fontSize.key);
      }

      if ('bold' in properties) {
        if (typeof properties['bold'] !== 'boolean') throw new Error('bold must be a boolean');
        for (const rPr of rPrs) setBooleanAttr(rPr, 'b', properties['bold']);
        applied.push('bold');
      }
      if ('italic' in properties) {
        if (typeof properties['italic'] !== 'boolean') throw new Error('italic must be a boolean');
        for (const rPr of rPrs) setBooleanAttr(rPr, 'i', properties['italic']);
        applied.push('italic');
      }
      if ('underline' in properties) {
        if (typeof properties['underline'] !== 'boolean')
          throw new Error('underline must be a boolean');
        for (const rPr of rPrs) {
          if (properties['underline']) rPr.setAttribute('u', 'sng');
          else rPr.removeAttribute('u');
        }
        applied.push('underline');
      }
    }

    if ('hidden' in properties) {
      if (typeof properties['hidden'] !== 'boolean') throw new Error('hidden must be a boolean');
      setHidden(node, properties['hidden']);
      applied.push('hidden');
    }
  } catch (cause) {
    return err('INVALID_COMMAND', cause instanceof Error ? cause.message : 'Invalid properties');
  }

  return ok({ applied });
}

export function assertChartProperties(properties: Record<string, unknown>): Result<void> {
  const unexpected = unknownKeys(properties, CHART_KEYS);
  if (unexpected.length)
    return err('INVALID_COMMAND', `Unsupported chart setProperties keys: ${unexpected.join(', ')}`);
  return ok(undefined);
}

export const shapePropertyKeys = [...SHAPE_KEYS].sort();
