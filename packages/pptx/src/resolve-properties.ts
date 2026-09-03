import type { PropertyValue, ResolveMode } from '@deckflow/deckuse-core';
import type { OpcArchive } from '@deckflow/deckuse-opc';
import type { Document, Element } from '@xmldom/xmldom';
import type { ResolvedTarget } from './addressing.js';
import { cNvPrIdOf } from './addressing.js';
import type { IndexedElement } from './types.js';
import { NS, REL, attr, children, cNvPr, descendants, first, root, textOf } from './xml.js';

const EMU_PER_PT = 12700;
const SHAPE_LOCAL_NAMES = new Set(['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp']);

const directChild = (node: Element, localName: string): Element | undefined =>
  children(node).find((child) => child.localName === localName);

const shapeByCNvPrId = (doc: Document, id: string): Element | undefined =>
  descendants(doc).find(
    (node) =>
      node.localName != null &&
      SHAPE_LOCAL_NAMES.has(node.localName) &&
      attr(cNvPr(node), 'id') === id,
  );

const nodeForItem = (doc: Document, item: IndexedElement): Element | undefined => {
  if (['slide', 'notes', 'master', 'layout', 'theme'].includes(item.kind)) return root(doc);
  const id = cNvPrIdOf(item);
  return id ? shapeByCNvPrId(doc, id) : undefined;
};

const prop = (
  effective: unknown,
  direct: unknown,
  source?: PropertyValue['source'],
  unit?: string,
): PropertyValue => {
  const inherited = direct === null || direct === undefined;
  return {
    effective: effective ?? null,
    direct: direct ?? null,
    inherited,
    ...(source ? { source } : inherited ? { source: { scope: 'default' as const } } : {}),
    ...(unit ? { unit } : {}),
  };
};

const readSrgb = (node: Element | undefined): string | undefined => {
  if (!node) return undefined;
  const srgb = first(node, 'srgbClr');
  const val = attr(srgb, 'val');
  if (val) return `#${val.toUpperCase()}`;
  return undefined;
};

const readSchemeColor = (
  node: Element | undefined,
  themeColors: Map<string, string>,
): string | undefined => {
  if (!node) return undefined;
  const scheme = first(node, 'schemeClr');
  const name = attr(scheme, 'val');
  if (!name) return undefined;
  const mapped = themeColors.get(name) ?? themeColors.get(name.toLowerCase());
  return mapped ? `#${mapped.replace(/^#/, '').toUpperCase()}` : undefined;
};

const readFillColor = (
  container: Element | undefined,
  themeColors: Map<string, string>,
): { kind: string; color: string | null; transparency: number | null } | undefined => {
  if (!container) return undefined;
  if (directChild(container, 'noFill')) return { kind: 'none', color: null, transparency: null };
  const solid = directChild(container, 'solidFill');
  if (solid) {
    const color = readSrgb(solid) ?? readSchemeColor(solid, themeColors) ?? null;
    const alpha = attr(first(solid, 'alpha') ?? first(solid, 'srgbClr'), 'val');
    // alpha on srgbClr child
    const alphaNode = descendants(solid, 'alpha')[0];
    const alphaVal = attr(alphaNode, 'val');
    let transparency: number | null = null;
    if (alphaVal !== undefined) {
      const n = Number(alphaVal);
      if (Number.isFinite(n)) transparency = Math.round((1 - n / 100000) * 100);
    }
    void alpha;
    return { kind: 'solid', color, transparency };
  }
  return undefined;
};

const loadThemeColors = (archive: OpcArchive, themePart: string | undefined): Map<string, string> => {
  const map = new Map<string, string>();
  if (!themePart || !archive.getPart(themePart)) return map;
  const doc = archive.readXml(themePart);
  const scheme = first(doc, 'clrScheme');
  if (!scheme) return map;
  for (const child of children(scheme)) {
    const name = child.localName;
    if (!name) continue;
    const srgb = attr(first(child, 'srgbClr'), 'val');
    const sys = attr(first(child, 'sysClr'), 'lastClr');
    const val = srgb ?? sys;
    if (val) {
      map.set(name, val.toUpperCase());
      map.set(name.toLowerCase(), val.toUpperCase());
    }
  }
  return map;
};

const loadThemeFonts = (
  archive: OpcArchive,
  themePart: string | undefined,
): { major?: string; minor?: string } => {
  if (!themePart || !archive.getPart(themePart)) return {};
  const doc = archive.readXml(themePart);
  const major = attr(first(first(doc, 'majorFont') ?? doc, 'latin'), 'typeface');
  const minor = attr(first(first(doc, 'minorFont') ?? doc, 'latin'), 'typeface');
  return { ...(major ? { major } : {}), ...(minor ? { minor } : {}) };
};

interface StyleChain {
  layoutPart?: string;
  masterPart?: string;
  themePart?: string;
  layoutTarget?: string;
  masterTarget?: string;
}

const resolveStyleChain = (archive: OpcArchive, slidePart: string): StyleChain => {
  const slideRels = archive.getRelationships(slidePart);
  const layoutRel = slideRels.find((r) => r.type === REL.layout);
  const layoutPart = layoutRel?.resolvedTarget;
  let masterPart: string | undefined;
  let themePart: string | undefined;
  if (layoutPart) {
    const layoutRels = archive.getRelationships(layoutPart);
    const masterRel = layoutRels.find((r) => r.type === REL.slideMaster);
    masterPart = masterRel?.resolvedTarget;
  }
  if (masterPart) {
    const masterRels = archive.getRelationships(masterPart);
    const themeRel = masterRels.find((r) => r.type === REL.theme);
    themePart = themeRel?.resolvedTarget;
  }
  if (!themePart) {
    const theme = [...archive.parts.keys()].find((name) =>
      name.startsWith('/ppt/theme/') && name.endsWith('.xml'),
    );
    themePart = theme;
  }
  return {
    ...(layoutPart
      ? {
          layoutPart,
          layoutTarget: `layout:${layoutPart.split('/').pop()?.replace(/\.xml$/, '') ?? layoutPart}`,
        }
      : {}),
    ...(masterPart
      ? {
          masterPart,
          masterTarget: `master:${masterPart.split('/').pop()?.replace(/\.xml$/, '') ?? masterPart}`,
        }
      : {}),
    ...(themePart ? { themePart } : {}),
  };
};

const placeholderOf = (node: Element): { type?: string; idx?: string } | undefined => {
  const ph = first(node, 'ph');
  if (!ph) return undefined;
  const type = attr(ph, 'type') ?? 'body';
  const idx = attr(ph, 'idx');
  return { type, ...(idx !== undefined ? { idx } : {}) };
};

const findPlaceholderShape = (
  doc: Document,
  type: string | undefined,
  idx: string | undefined,
): Element | undefined => {
  for (const node of descendants(doc)) {
    if (!node.localName || !SHAPE_LOCAL_NAMES.has(node.localName)) continue;
    const ph = placeholderOf(node);
    if (!ph) continue;
    if (idx !== undefined && ph.idx === idx) return node;
    if (type && ph.type === type && (idx === undefined || ph.idx === undefined)) return node;
  }
  return undefined;
};

const txStyleLevel = (
  masterDoc: Document,
  styleKind: 'title' | 'body' | 'other',
  level: number,
): Element | undefined => {
  const styles = first(masterDoc, 'txStyles');
  if (!styles) return undefined;
  const blockName =
    styleKind === 'title' ? 'titleStyle' : styleKind === 'body' ? 'bodyStyle' : 'otherStyle';
  const block = directChild(styles, blockName) ?? first(styles, blockName);
  if (!block) return undefined;
  if (level === 0) return directChild(block, 'defPPr') ?? first(block, 'defPPr') ?? directChild(block, 'lvl1pPr') ?? first(block, 'lvl1pPr');
  const name = `lvl${level + 1}pPr`;
  return directChild(block, name) ?? first(block, name);
};

const styleKindForPlaceholder = (type: string | undefined): 'title' | 'body' | 'other' => {
  if (!type) return 'body';
  if (type === 'title' || type === 'ctrTitle') return 'title';
  if (type === 'body' || type === 'obj' || type === 'subTitle') return 'body';
  return 'other';
};

const readFontFromRPr = (
  rPr: Element | undefined,
  themeFonts: { major?: string; minor?: string },
  themeColors: Map<string, string>,
): {
  family?: string;
  size?: number;
  weight?: string;
  italic?: boolean;
  underline?: boolean;
  color?: string;
} => {
  if (!rPr) return {};
  const sz = attr(rPr, 'sz');
  const size = sz !== undefined ? Number(sz) / 100 : undefined;
  const latin = attr(directChild(rPr, 'latin'), 'typeface');
  let family = latin;
  if (family?.startsWith('+mj-')) family = themeFonts.major;
  if (family?.startsWith('+mn-')) family = themeFonts.minor;
  const bold = attr(rPr, 'b');
  const italic = attr(rPr, 'i');
  const underline = attr(rPr, 'u');
  const solid = directChild(rPr, 'solidFill');
  const color = solid
    ? (readSrgb(solid) ?? readSchemeColor(solid, themeColors))
    : undefined;
  return {
    ...(family ? { family } : {}),
    ...(size !== undefined && Number.isFinite(size) ? { size } : {}),
    ...(bold === '1' || bold === 'true' ? { weight: 'bold' } : bold === '0' ? { weight: 'regular' } : {}),
    ...(italic === '1' || italic === 'true'
      ? { italic: true }
      : italic === '0'
        ? { italic: false }
        : {}),
    ...(underline && underline !== 'none' ? { underline: true } : {}),
    ...(color ? { color } : {}),
  };
};

const firstRunRPr = (node: Element): Element | undefined => {
  const run = descendants(node, 'r')[0];
  return run ? directChild(run, 'rPr') : undefined;
};

const defRPrFromLevel = (level: Element | undefined): Element | undefined => {
  if (!level) return undefined;
  return directChild(level, 'defRPr') ?? first(level, 'defRPr');
};

const readTransform = (node: Element): Record<string, number | boolean | null> => {
  const xfrm = first(node, 'xfrm');
  const off = xfrm ? first(xfrm, 'off') : undefined;
  const ext = xfrm ? first(xfrm, 'ext') : undefined;
  const rot = attr(xfrm, 'rot');
  return {
    x: attr(off, 'x') !== undefined ? Number(attr(off, 'x')) : null,
    y: attr(off, 'y') !== undefined ? Number(attr(off, 'y')) : null,
    width: attr(ext, 'cx') !== undefined ? Number(attr(ext, 'cx')) : null,
    height: attr(ext, 'cy') !== undefined ? Number(attr(ext, 'cy')) : null,
    rotation: rot !== undefined ? Number(rot) / 60000 : null,
    'flip.x': attr(xfrm, 'flipH') === '1',
    'flip.y': attr(xfrm, 'flipV') === '1',
  };
};

const filterProps = (
  all: Record<string, PropertyValue>,
  props: string[] | undefined,
  mode: ResolveMode,
  includeProvenance: boolean,
): Record<string, PropertyValue | unknown> => {
  const keys = props?.length ? props : Object.keys(all);
  const out: Record<string, PropertyValue | unknown> = {};
  for (const key of keys) {
    const value = all[key];
    if (!value) continue;
    if (mode === 'effective') {
      out[key] = includeProvenance
        ? {
            effective: value.effective,
            inherited: value.inherited,
            ...(value.source ? { source: value.source } : {}),
            ...(value.unit ? { unit: value.unit } : {}),
          }
        : value.effective;
    } else if (mode === 'direct') {
      out[key] = includeProvenance
        ? {
            direct: value.direct,
            inherited: value.inherited,
            ...(value.unit ? { unit: value.unit } : {}),
          }
        : value.direct;
    } else {
      out[key] = includeProvenance
        ? value
        : { effective: value.effective, direct: value.direct, inherited: value.inherited };
    }
  }
  return out;
};

export function resolveProperties(
  archive: OpcArchive,
  resolved: ResolvedTarget,
  options: {
    resolve?: ResolveMode;
    props?: string[];
    provenance?: boolean;
  } = {},
): {
  target: string;
  uid: string;
  name?: string;
  properties: Record<string, PropertyValue | unknown>;
  warnings: string[];
} {
  const mode = options.resolve ?? 'both';
  const includeProvenance = options.provenance !== false;
  const warnings: string[] = [];
  const item = resolved.item;
  const doc = archive.readXml(item.partUri);
  const node = nodeForItem(doc, item);

  if (!node) {
    warnings.push('Element XML node was not found; returning empty properties');
    return {
      target: resolved.target,
      uid: resolved.uid,
      ...(item.name ? { name: item.name } : {}),
      properties: {},
      warnings,
    };
  }

  if (item.kind === 'slide' || item.kind === 'master' || item.kind === 'layout' || item.kind === 'theme') {
    const properties: Record<string, PropertyValue> = {
      name: prop(item.name ?? null, item.name ?? null, { scope: 'local', target: resolved.target }),
    };
    return {
      target: resolved.target,
      uid: resolved.uid,
      ...(item.name ? { name: item.name } : {}),
      properties: filterProps(properties, options.props, mode, includeProvenance),
      warnings,
    };
  }

  const chain = resolveStyleChain(archive, item.partUri);
  const themeColors = loadThemeColors(archive, chain.themePart);
  const themeFonts = loadThemeFonts(archive, chain.themePart);
  const all: Record<string, PropertyValue> = {};

  const name = attr(cNvPr(node), 'name') ?? null;
  all['name'] = prop(name, name, { scope: 'local', target: resolved.target, path: 'name' });

  const nvPr = first(node, 'nvPr');
  const hidden = attr(nvPr, 'hidden') === '1';
  all['visible'] = prop(!hidden, !hidden, { scope: 'local', target: resolved.target, path: 'visible' });

  const xfrm = readTransform(node);
  for (const [key, value] of Object.entries(xfrm)) {
    const unit = ['x', 'y', 'width', 'height'].includes(key)
      ? 'emu'
      : key === 'rotation'
        ? 'deg'
        : undefined;
    all[key] = prop(value, value, { scope: 'local', target: resolved.target, path: key }, unit);
  }

  const spPr = directChild(node, 'spPr') ?? first(node, 'spPr');
  const directFill = readFillColor(spPr, themeColors);
  all['fill.kind'] = prop(
    directFill?.kind ?? null,
    directFill?.kind ?? null,
    directFill
      ? { scope: 'local', target: resolved.target, path: 'fill.kind' }
      : { scope: 'default' },
  );
  all['fill.color'] = prop(
    directFill?.color ?? null,
    directFill?.color ?? null,
    directFill?.color
      ? { scope: 'local', target: resolved.target, path: 'fill.color' }
      : { scope: 'default' },
  );
  all['fill.transparency'] = prop(
    directFill?.transparency ?? null,
    directFill?.transparency ?? null,
    directFill?.transparency !== null && directFill?.transparency !== undefined
      ? { scope: 'local', target: resolved.target, path: 'fill.transparency' }
      : { scope: 'default' },
  );

  const ln = spPr ? directChild(spPr, 'ln') : undefined;
  if (ln && directChild(ln, 'noFill')) {
    all['line.kind'] = prop('none', 'none', {
      scope: 'local',
      target: resolved.target,
      path: 'line.kind',
    });
    all['line.color'] = prop(null, null, { scope: 'local', target: resolved.target, path: 'line.color' });
    all['line.width'] = prop(null, null, { scope: 'local', target: resolved.target, path: 'line.width' }, 'pt');
  } else if (ln) {
    const lineFill = readFillColor(ln, themeColors);
    const w = attr(ln, 'w');
    all['line.kind'] = prop('solid', 'solid', {
      scope: 'local',
      target: resolved.target,
      path: 'line.kind',
    });
    all['line.color'] = prop(
      lineFill?.color ?? null,
      lineFill?.color ?? null,
      { scope: 'local', target: resolved.target, path: 'line.color' },
    );
    all['line.width'] = prop(
      w !== undefined ? Number(w) / EMU_PER_PT : null,
      w !== undefined ? Number(w) / EMU_PER_PT : null,
      { scope: 'local', target: resolved.target, path: 'line.width' },
      'pt',
    );
  } else {
    all['line.kind'] = prop(null, null, { scope: 'default' });
    all['line.color'] = prop(null, null, { scope: 'default' });
    all['line.width'] = prop(null, null, { scope: 'default' }, 'pt');
  }

  const text = textOf(node).replace(/\s+/g, ' ').trim();
  all['text.value'] = prop(text || null, text || null, {
    scope: 'local',
    target: resolved.target,
    path: 'text.value',
  });

  const directRPr = firstRunRPr(node);
  const directFont = readFontFromRPr(directRPr, themeFonts, themeColors);

  const ph = placeholderOf(node);
  let inheritedFont: ReturnType<typeof readFontFromRPr> = {};
  let inheritedSource: PropertyValue['source'] | undefined;

  if (!directFont.size || !directFont.family || !directFont.color) {
    // Try layout placeholder shape defRPr / list style, then master txStyles.
    if (ph && chain.layoutPart && archive.getPart(chain.layoutPart)) {
      const layoutDoc = archive.readXml(chain.layoutPart);
      const layoutShape = findPlaceholderShape(layoutDoc, ph.type, ph.idx);
      if (layoutShape) {
        const layoutRPr = firstRunRPr(layoutShape) ?? defRPrFromLevel(first(layoutShape, 'lstStyle') ? first(first(layoutShape, 'lstStyle')!, 'defPPr') : undefined);
        const fromLayout = readFontFromRPr(layoutRPr, themeFonts, themeColors);
        inheritedFont = { ...fromLayout, ...inheritedFont };
        if (fromLayout.size || fromLayout.family || fromLayout.color) {
          inheritedSource = {
            scope: 'layout',
            target: chain.layoutTarget,
            path: 'placeholder.font',
          };
        }
      }
    }
    if (chain.masterPart && archive.getPart(chain.masterPart)) {
      const masterDoc = archive.readXml(chain.masterPart);
      const styleKind = styleKindForPlaceholder(ph?.type);
      const level = txStyleLevel(masterDoc, styleKind, 0);
      const fromMaster = readFontFromRPr(defRPrFromLevel(level), themeFonts, themeColors);
      inheritedFont = { ...fromMaster, ...inheritedFont };
      if (!inheritedSource && (fromMaster.size || fromMaster.family || fromMaster.color)) {
        inheritedSource = {
          scope: 'master',
          target: chain.masterTarget,
          path: `textStyles.${styleKind}.level.0.font`,
        };
      }
      // Also match placeholder shape on master.
      if (ph) {
        const masterShape = findPlaceholderShape(masterDoc, ph.type, ph.idx);
        if (masterShape) {
          const masterRPr = firstRunRPr(masterShape);
          const fromMasterShape = readFontFromRPr(masterRPr, themeFonts, themeColors);
          inheritedFont = { ...fromMasterShape, ...inheritedFont };
        }
      }
    }
    if (!inheritedFont.family && themeFonts.minor) {
      inheritedFont = { ...inheritedFont, family: themeFonts.minor };
      if (!inheritedSource)
        inheritedSource = { scope: 'theme', target: 'theme', path: 'fontScheme.minorFont' };
    }
  }

  const mergeFont = <K extends keyof typeof directFont>(
    key: K,
    propName: string,
    unit?: string,
  ): void => {
    const direct = directFont[key] ?? null;
    const effective = (directFont[key] ?? inheritedFont[key] ?? null) as unknown;
    const source: PropertyValue['source'] | undefined =
      direct !== null && direct !== undefined
        ? { scope: 'local', target: resolved.target, path: propName }
        : inheritedFont[key] !== undefined
          ? inheritedSource ?? { scope: 'default' }
          : { scope: 'default' };
    // Refine path for master font.size
    const refined =
      source?.scope === 'master' && propName.startsWith('font.')
        ? {
            ...source,
            path: `${source.path?.replace(/\.font$/, '') ?? 'textStyles.body.level.0'}.${propName}`,
          }
        : source;
    all[propName] = prop(effective, direct, refined, unit);
  };

  mergeFont('family', 'font.family');
  mergeFont('size', 'font.size', 'pt');
  mergeFont('weight', 'font.weight');
  mergeFont('italic', 'font.italic');
  mergeFont('underline', 'font.underline');
  mergeFont('color', 'font.color');

  const pPr = first(descendants(node, 'p')[0] ?? node, 'pPr');
  const align = attr(pPr, 'algn');
  const lvl = attr(pPr, 'lvl');
  all['paragraph.align'] = prop(
    align ?? null,
    align ?? null,
    align
      ? { scope: 'local', target: resolved.target, path: 'paragraph.align' }
      : { scope: 'default' },
  );
  all['paragraph.level'] = prop(
    lvl !== undefined ? Number(lvl) : 0,
    lvl !== undefined ? Number(lvl) : null,
    lvl !== undefined
      ? { scope: 'local', target: resolved.target, path: 'paragraph.level' }
      : { scope: 'default' },
  );

  return {
    target: resolved.target,
    uid: resolved.uid,
    ...(name ? { name } : {}),
    properties: filterProps(all, options.props, mode, includeProvenance),
    warnings,
  };
}

/** Map Phase-1 dotted property names to legacy setProperties keys. */
export const mapDottedProperties = (
  properties: Record<string, unknown>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    switch (key) {
      case 'font.family':
        out['fontFamily'] = value;
        break;
      case 'font.size':
        out['fontSize'] = value;
        break;
      case 'font.weight':
        out['bold'] = value === 'bold' || value === true;
        break;
      case 'font.italic':
        out['italic'] = value;
        break;
      case 'font.underline':
        out['underline'] = value;
        break;
      case 'font.color':
        out['textColor'] = typeof value === 'string' ? value.replace(/^#/, '') : value;
        break;
      case 'fill.color':
        out['fill'] =
          typeof value === 'string' ? value.replace(/^#/, '') : value;
        break;
      case 'fill.kind':
        if (value === 'none') out['fill'] = 'none';
        break;
      case 'fill.transparency':
        // Stored via fill object when combined; ignore alone for now.
        break;
      case 'line.color':
      case 'line.kind':
      case 'line.width':
      case 'line.dash': {
        const line = (out['line'] as Record<string, unknown> | undefined) ?? {};
        if (key === 'line.color' && typeof value === 'string')
          line['color'] = value.replace(/^#/, '');
        else if (key === 'line.kind' && value === 'none') out['line'] = 'none';
        else if (key === 'line.width') line['width'] = value;
        else if (key === 'line.dash') line['dash'] = value;
        if (out['line'] !== 'none') out['line'] = { ...line };
        break;
      }
      case 'text.value':
        out['text'] = value;
        break;
      case 'name':
        out['name'] = value;
        break;
      case 'visible':
        out['hidden'] = value === false;
        break;
      default:
        out[key] = value;
    }
  }
  // Combine fill.color + transparency
  if ('fill.color' in properties || 'fill.transparency' in properties) {
    const color = properties['fill.color'];
    const transparency = properties['fill.transparency'];
    if (typeof color === 'string') {
      out['fill'] =
        transparency !== undefined
          ? { type: 'solid', color: color.replace(/^#/, ''), transparency }
          : color.replace(/^#/, '');
    }
  }
  return out;
};
