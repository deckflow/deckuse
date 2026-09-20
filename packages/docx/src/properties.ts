import { err, ok, parseLength, type Result } from '@deckflow/deckuse-core';
import { parseXml, type OpcArchive } from '@deckflow/deckuse-opc';
import type { Element } from '@xmldom/xmldom';
import { visibleRuns } from './text-spans.js';
import type { ElementKind } from './types.js';
import { STYLES_PART, attr, children, descendants, wEl } from './xml.js';

const TWIPS_PER_EMU = 635;

const ALIGN: Record<string, string> = {
  l: 'left',
  left: 'left',
  start: 'left',
  ctr: 'center',
  center: 'center',
  r: 'right',
  right: 'right',
  end: 'right',
  just: 'both',
  justify: 'both',
  both: 'both',
};

const CANONICAL = new Set([
  'fontSize',
  'fontFamily',
  'textColor',
  'bold',
  'italic',
  'underline',
  'paragraph.align',
  'paragraph.style',
  'paragraph.spacingBefore',
  'paragraph.spacingAfter',
]);

export interface RunProps {
  fontSize?: number;
  fontFamily?: string;
  textColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

const asBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value >= 600;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (['true', 'bold', '1', 'yes'].includes(lowered)) return true;
    if (['false', '0', 'no', 'normal'].includes(lowered)) return false;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric >= 600;
  }
  return undefined;
};

export const normalizeProperties = (
  properties: Record<string, unknown>,
): Result<Record<string, unknown>> => {
  const next: Record<string, unknown> = {};
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    const canonical =
      key === 'size' || key === 'font.size'
        ? 'fontSize'
        : key === 'font' || key === 'font.family'
          ? 'fontFamily'
          : key === 'fontColor' || key === 'font.color'
            ? 'textColor'
            : key === 'font.italic'
              ? 'italic'
              : key === 'font.underline'
                ? 'underline'
                : key === 'font.weight'
                  ? 'bold'
                  : key === 'align'
                    ? 'paragraph.align'
                    : key === 'style'
                      ? 'paragraph.style'
                      : key;
    if (!CANONICAL.has(canonical)) {
      unknown.push(key);
      continue;
    }
    next[canonical] = key === 'font.weight' ? (asBoolean(value) ?? value) : value;
  }
  if (unknown.length > 0) {
    return err(
      'INVALID_COMMAND',
      `Unknown property ${unknown.join(', ')}`,
      unknown.map((key) => ({
        severity: 'error' as const,
        code: 'UNKNOWN_PROPERTY',
        message: `Unknown property ${key}`,
        path: [key],
      })),
      {
        hint: 'Use fontSize, bold, italic, underline, textColor, fontFamily, paragraph.align, or paragraph.style.',
      },
    );
  }
  return ok(next);
};

export const styleExists = (archive: OpcArchive, styleId: string): boolean => {
  const part = archive.getPart(STYLES_PART);
  if (!part) return false;
  const doc = parseXml(part.data);
  return descendants(doc, 'style').some((style) => attr(style, 'w:styleId') === styleId);
};

const ensureChild = (parent: Element, name: string, first = false): Element => {
  const existing = children(parent).find((child) => child.localName === name);
  if (existing) return existing;
  const doc = parent.ownerDocument;
  if (!doc) throw new Error('Node has no document');
  const created = wEl(doc, name);
  if (first && parent.firstChild) parent.insertBefore(created, parent.firstChild);
  else parent.appendChild(created);
  return created;
};

const setToggle = (rPr: Element, name: string, on: boolean): void => {
  let node = children(rPr).find((child) => child.localName === name);
  if (!node) {
    const doc = rPr.ownerDocument;
    if (!doc) return;
    node = wEl(doc, name);
    rPr.appendChild(node);
  }
  if (on) node.removeAttribute('w:val');
  else node.setAttribute('w:val', '0');
};

export const applyRunProps = (run: Element, props: RunProps): Result<true> => {
  const doc = run.ownerDocument;
  if (!doc) return err('INTERNAL_ERROR', 'Run has no document');
  if (
    props.fontSize === undefined &&
    props.fontFamily === undefined &&
    props.textColor === undefined &&
    props.bold === undefined &&
    props.italic === undefined &&
    props.underline === undefined
  ) {
    return ok(true);
  }
  const rPr = ensureChild(run, 'rPr', true);
  if (props.bold !== undefined) setToggle(rPr, 'b', props.bold);
  if (props.italic !== undefined) setToggle(rPr, 'i', props.italic);
  if (props.underline !== undefined) {
    let underline = children(rPr).find((child) => child.localName === 'u');
    if (props.underline) {
      if (!underline) {
        underline = wEl(doc, 'u');
        rPr.appendChild(underline);
      }
      underline.setAttribute('w:val', 'single');
    } else if (underline) {
      underline.setAttribute('w:val', 'none');
    }
  }
  if (props.fontSize !== undefined) {
    if (!(props.fontSize > 0))
      return err('INVALID_COMMAND', 'fontSize must be a positive number of points');
    const half = String(Math.round(props.fontSize * 2));
    for (const name of ['sz', 'szCs'] as const) {
      let node = children(rPr).find((child) => child.localName === name);
      if (!node) {
        node = wEl(doc, name);
        rPr.appendChild(node);
      }
      node.setAttribute('w:val', half);
    }
  }
  if (props.textColor !== undefined) {
    const hex = props.textColor.trim().replace(/^#/, '').toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(hex))
      return err(
        'INVALID_COMMAND',
        `textColor must be a 6-digit hex color, got ${props.textColor}`,
      );
    let color = children(rPr).find((child) => child.localName === 'color');
    if (!color) {
      color = wEl(doc, 'color');
      rPr.appendChild(color);
    }
    color.setAttribute('w:val', hex);
  }
  if (props.fontFamily !== undefined) {
    if (!props.fontFamily.trim())
      return err('INVALID_COMMAND', 'fontFamily must be a non-empty string');
    let fonts = children(rPr).find((child) => child.localName === 'rFonts');
    if (!fonts) {
      fonts = wEl(doc, 'rFonts');
      rPr.appendChild(fonts);
    }
    const family = props.fontFamily.trim();
    for (const key of ['w:ascii', 'w:hAnsi', 'w:eastAsia', 'w:cs']) fonts.setAttribute(key, family);
  }
  return ok(true);
};

const setAlign = (paragraph: Element, align: string): Result<true> => {
  const mapped = ALIGN[align.toLowerCase()];
  if (!mapped) return err('INVALID_COMMAND', `Unsupported paragraph.align: ${align}`);
  const pPr = ensureChild(paragraph, 'pPr', true);
  const doc = paragraph.ownerDocument;
  if (!doc) return err('INTERNAL_ERROR', 'Paragraph has no document');
  let jc = children(pPr).find((child) => child.localName === 'jc');
  if (!jc) {
    jc = wEl(doc, 'jc');
    pPr.appendChild(jc);
  }
  jc.setAttribute('w:val', mapped);
  return ok(true);
};

export const setParagraphStyle = (paragraph: Element, styleId: string): void => {
  const pPr = ensureChild(paragraph, 'pPr', true);
  const doc = paragraph.ownerDocument;
  if (!doc) throw new Error('Paragraph has no document');
  let pStyle = children(pPr).find((child) => child.localName === 'pStyle');
  if (!pStyle) {
    pStyle = wEl(doc, 'pStyle');
    pPr.insertBefore(pStyle, pPr.firstChild);
  }
  pStyle.setAttribute('w:val', styleId);
};

const setSpacing = (
  paragraph: Element,
  which: 'before' | 'after',
  value: unknown,
): Result<true> => {
  if (typeof value !== 'string' && typeof value !== 'number')
    return err(
      'INVALID_COMMAND',
      `paragraph.spacing${which === 'before' ? 'Before' : 'After'} must be a length`,
    );
  let emu: number;
  try {
    emu = parseLength(value);
  } catch (cause) {
    return err('INVALID_COMMAND', cause instanceof Error ? cause.message : 'Invalid length');
  }
  const twips = String(Math.max(0, Math.round(emu / TWIPS_PER_EMU)));
  const pPr = ensureChild(paragraph, 'pPr', true);
  const doc = paragraph.ownerDocument;
  if (!doc) return err('INTERNAL_ERROR', 'Paragraph has no document');
  let spacing = children(pPr).find((child) => child.localName === 'spacing');
  if (!spacing) {
    spacing = wEl(doc, 'spacing');
    pPr.appendChild(spacing);
  }
  spacing.setAttribute(which === 'before' ? 'w:before' : 'w:after', twips);
  return ok(true);
};

const runPropsOf = (properties: Record<string, unknown>): RunProps => {
  const props: RunProps = {};
  if (typeof properties['fontSize'] === 'number') props.fontSize = properties['fontSize'];
  if (typeof properties['fontFamily'] === 'string') props.fontFamily = properties['fontFamily'];
  if (typeof properties['textColor'] === 'string') props.textColor = properties['textColor'];
  const bold = asBoolean(properties['bold']);
  if (bold !== undefined && properties['bold'] !== undefined) props.bold = bold;
  const italic = asBoolean(properties['italic']);
  if (italic !== undefined && properties['italic'] !== undefined) props.italic = italic;
  const underline = asBoolean(properties['underline']);
  if (underline !== undefined && properties['underline'] !== undefined) props.underline = underline;
  return props;
};

export const applyProperties = (
  archive: OpcArchive,
  element: Element,
  kind: ElementKind,
  properties: Record<string, unknown>,
): Result<true> => {
  if (kind === 'style' || kind === 'section') {
    return err(
      'UNSUPPORTED_CAPABILITY',
      `Writing ${kind === 'style' ? 'styles.xml' : 'section properties'} is not available`,
      [],
      {
        hint: 'Apply an existing style with paragraph.style on a paragraph. Defining styles, numbering, or theme parts is rejected.',
      },
    );
  }
  const normalized = normalizeProperties(properties);
  if (!normalized.ok) return normalized;
  const values = normalized.value;
  const paragraphKeys = Object.keys(values).some((key) => key.startsWith('paragraph.'));
  if (kind === 'run' && paragraphKeys)
    return err('INVALID_COMMAND', 'paragraph.* properties require a paragraph target', [], {
      hint: 'Target body/p:<n> instead of a run.',
    });
  if (kind === 'table' || kind === 'tableCell' || element.localName === 'tbl') {
    return err('INVALID_COMMAND', 'Set properties on a paragraph or run inside the table', [], {
      hint: 'Use body/table:<n>/row:<r>/cell:<c>/p:<n>.',
    });
  }
  if (element.localName !== 'p' && element.localName !== 'r')
    return err('INVALID_COMMAND', `Cannot set properties on ${element.localName ?? 'this target'}`);

  const paragraph = element.localName === 'p' ? element : undefined;
  if (paragraph) {
    const styleId = values['paragraph.style'];
    if (styleId !== undefined) {
      if (typeof styleId !== 'string' || !styleId.trim())
        return err('INVALID_COMMAND', 'paragraph.style must be a style id');
      if (!styleExists(archive, styleId))
        return err('TARGET_NOT_FOUND', `Style not found: ${styleId}`, [], {
          target: `style:${styleId}`,
          hint: 'deckuse list styles shows styleId values. This does not create styles.',
        });
      setParagraphStyle(paragraph, styleId);
    }
    const align = values['paragraph.align'];
    if (align !== undefined) {
      if (typeof align !== 'string')
        return err('INVALID_COMMAND', 'paragraph.align must be a string');
      const applied = setAlign(paragraph, align);
      if (!applied.ok) return applied;
    }
    if (values['paragraph.spacingBefore'] !== undefined) {
      const applied = setSpacing(paragraph, 'before', values['paragraph.spacingBefore']);
      if (!applied.ok) return applied;
    }
    if (values['paragraph.spacingAfter'] !== undefined) {
      const applied = setSpacing(paragraph, 'after', values['paragraph.spacingAfter']);
      if (!applied.ok) return applied;
    }
  }

  const runProps = runPropsOf(values);
  const runs = paragraph ? visibleRuns(paragraph) : [element];
  if (paragraph && runs.length === 0 && Object.keys(runProps).length > 0) {
    const doc = paragraph.ownerDocument;
    if (!doc) return err('INTERNAL_ERROR', 'Paragraph has no document');
    const run = wEl(doc, 'r');
    paragraph.appendChild(run);
    runs.push(run);
  }
  for (const run of runs) {
    const applied = applyRunProps(run, runProps);
    if (!applied.ok) return applied;
  }
  if (paragraph && Object.keys(runProps).length > 0) {
    const pPr = ensureChild(paragraph, 'pPr', true);
    const mark = ensureChild(pPr, 'rPr');
    const doc = paragraph.ownerDocument;
    if (!doc) return err('INTERNAL_ERROR', 'Paragraph has no document');
    const holder = wEl(doc, 'r');
    holder.appendChild(mark.cloneNode(true));
    const applied = applyRunProps(holder, runProps);
    if (!applied.ok) return applied;
    const updated = children(holder).find((child) => child.localName === 'rPr');
    if (updated) {
      const existing = children(pPr).find((child) => child.localName === 'rPr');
      if (existing) pPr.replaceChild(updated, existing);
      else pPr.appendChild(updated);
    }
  }
  return ok(true);
};

const toggleValue = (node: Element | undefined): boolean | undefined => {
  if (!node) return undefined;
  const value = attr(node, 'w:val');
  if (value === undefined) return true;
  return !['0', 'false', 'off', 'none'].includes(value.toLowerCase());
};

export const readProperties = (
  element: Element,
  kind: ElementKind,
): Record<string, { effective: unknown; direct: unknown; inherited: boolean }> => {
  const paragraph = element.localName === 'p' ? element : undefined;
  const run = paragraph
    ? visibleRuns(paragraph)[0]
    : element.localName === 'r'
      ? element
      : undefined;
  const pPr = paragraph
    ? children(paragraph).find((child) => child.localName === 'pPr')
    : undefined;
  const rPr = run ? children(run).find((child) => child.localName === 'rPr') : undefined;
  const entry = (value: unknown) => ({
    effective: value ?? null,
    direct: value ?? null,
    inherited: false,
  });
  const style = pPr
    ? attr(
        children(pPr).find((child) => child.localName === 'pStyle'),
        'w:val',
      )
    : undefined;
  const align = pPr
    ? attr(
        children(pPr).find((child) => child.localName === 'jc'),
        'w:val',
      )
    : undefined;
  const sz = rPr
    ? attr(
        children(rPr).find((child) => child.localName === 'sz'),
        'w:val',
      )
    : undefined;
  const color = rPr
    ? attr(
        children(rPr).find((child) => child.localName === 'color'),
        'w:val',
      )
    : undefined;
  const family = rPr
    ? attr(
        children(rPr).find((child) => child.localName === 'rFonts'),
        'w:ascii',
      )
    : undefined;
  const properties: Record<string, { effective: unknown; direct: unknown; inherited: boolean }> =
    {};
  if (kind === 'style') {
    properties['styleId'] = entry(attr(element, 'w:styleId'));
    properties['name'] = entry(
      attr(
        children(element).find((child) => child.localName === 'name'),
        'w:val',
      ),
    );
    return properties;
  }
  if (style) properties['paragraph.style'] = entry(style);
  if (align) properties['paragraph.align'] = entry(align);
  if (sz && Number(sz) > 0) properties['fontSize'] = entry(Number(sz) / 2);
  if (color) properties['textColor'] = entry(color);
  if (family) properties['fontFamily'] = entry(family);
  const bold = toggleValue(
    rPr ? children(rPr).find((child) => child.localName === 'b') : undefined,
  );
  if (bold !== undefined) properties['bold'] = entry(bold);
  const italic = toggleValue(
    rPr ? children(rPr).find((child) => child.localName === 'i') : undefined,
  );
  if (italic !== undefined) properties['italic'] = entry(italic);
  return properties;
};
