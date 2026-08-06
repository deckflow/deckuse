import { basename } from 'node:path';
import type { ElementRef } from '@deckuse/core';
import type { OpcArchive } from '@deckuse/opc';
import type { Element } from '@xmldom/xmldom';
import type { ElementKind, IndexFile, IndexedElement } from './types.js';
import { NS, REL, attr, cNvPr, children, descendants, first, root, textOf } from './xml.js';
const classify = (node: Element): ElementKind | undefined =>
  node.localName === 'sp'
    ? first(node, 'txBody')
      ? 'textbox'
      : 'shape'
    : node.localName === 'pic'
      ? 'picture'
      : node.localName === 'cxnSp'
        ? 'connector'
        : node.localName === 'grpSp'
          ? 'group'
          : first(node, 'tbl')
            ? 'table'
            : first(node, 'chart')
              ? 'chart'
              : undefined;
const transformOf = (node: Element): Record<string, number | boolean> | undefined => {
  const x = first(node, 'xfrm');
  if (!x) return;
  const off = first(x, 'off'),
    ext = first(x, 'ext'),
    result: Record<string, number | boolean> = {};
  for (const [key, n, a] of [
    ['x', off, 'x'],
    ['y', off, 'y'],
    ['width', ext, 'cx'],
    ['height', ext, 'cy'],
  ] as const) {
    const v = attr(n, a);
    if (v !== undefined) result[key] = Number(v);
  }
  const rot = attr(x, 'rot');
  if (rot !== undefined) result['rotation'] = Number(rot) / 60000;
  return result;
};
export function buildIndex(archive: OpcArchive, documentId: string, rev: string): IndexFile {
  const elements: IndexedElement[] = [];
  const presentation = archive.readXml('/ppt/presentation.xml'),
    rels = archive.getRelationships('/ppt/presentation.xml');
  for (const sld of descendants(presentation, 'sldId')) {
    const rid = sld.getAttributeNS(NS.r, 'id') ?? attr(sld, 'r:id'),
      rel = rels.find((r) => r.id === rid);
    if (!rel?.resolvedTarget) continue;
    const partUri = rel.resolvedTarget,
      slideId = attr(sld, 'id') ?? rid ?? basename(partUri),
      slideRef: ElementRef = {
        documentId,
        elementId: `slide:${slideId}`,
        path: partUri,
        revision: rev,
      };
    elements.push({
      ref: slideRef,
      kind: 'slide',
      partUri,
      slideId,
      name: `Slide ${slideId}`,
      location: { slideId, partUri },
    });
    const doc = archive.readXml(partUri);
    const walk = (node: Element, ancestors: string[], parentId: string): void => {
      for (const child of children(node)) {
        const kind = classify(child);
        if (!kind) {
          walk(child, ancestors, parentId);
          continue;
        }
        const own = attr(cNvPr(child), 'id') ?? child.nodeName,
          id = `${slideId}:${[...ancestors, own].join('.')}`,
          transform = transformOf(child),
          name = attr(cNvPr(child), 'name'),
          text = textOf(child);
        const indexed: IndexedElement = {
          ref: { documentId, elementId: id, path: `${partUri}#${id}`, revision: rev },
          kind,
          partUri,
          slideId,
          parentId,
          location: { slideId, partUri, ancestorIds: ancestors, cNvPrId: own },
          ...(name ? { name } : {}),
          ...(text ? { text } : {}),
          ...(transform ? { transform } : {}),
        };
        elements.push(indexed);
        if (kind === 'table') {
          const rows = descendants(child, 'tr');
          rows.forEach((row, rowIndex) => {
            children(row)
              .filter((n) => n.localName === 'tc')
              .forEach((cell, columnIndex) =>
                elements.push({
                  ref: {
                    documentId,
                    elementId: `${id}:cell:${String(rowIndex)}:${String(columnIndex)}`,
                    path: `${partUri}#${id}:cell:${String(rowIndex)}:${String(columnIndex)}`,
                    revision: rev,
                  },
                  kind: 'tableCell',
                  partUri,
                  slideId,
                  parentId: id,
                  text: textOf(cell),
                  location: { slideId, partUri, tableId: id, row: rowIndex, column: columnIndex },
                }),
              );
          });
        }
        if (kind === 'chart') {
          const crid =
              first(child, 'chart')?.getAttributeNS(NS.r, 'id') ??
              attr(first(child, 'chart'), 'r:id'),
            cr = archive.getRelationships(partUri).find((r) => r.id === crid);
          if (cr?.resolvedTarget) {
            const chart = archive.readXml(cr.resolvedTarget);
            indexed.payload = {
              chartPart: cr.resolvedTarget,
              title: textOf(first(chart, 'title') ?? chart),
              series: descendants(chart, 'ser').map((ser) => ({
                name:
                  first(first(ser, 'tx') ?? ser, 'v')?.textContent ??
                  textOf(first(ser, 'tx') ?? ser),
                values: descendants(first(ser, 'val') ?? ser, 'v').map((v) => v.textContent ?? ''),
              })),
              embeddedWorkbook: archive
                .getRelationships(cr.resolvedTarget)
                .some((r) => r.type === REL.package),
            };
          }
        }
        walk(child, [...ancestors, own], id);
      }
    };
    walk(root(doc), [], `slide:${slideId}`);
    const notes = archive.getRelationships(partUri).find((r) => r.type === REL.notes);
    if (notes?.resolvedTarget) {
      const nd = archive.readXml(notes.resolvedTarget);
      elements.push({
        ref: {
          documentId,
          elementId: `notes:${slideId}`,
          path: notes.resolvedTarget,
          revision: rev,
        },
        kind: 'notes',
        partUri: notes.resolvedTarget,
        slideId,
        text: textOf(nd),
        location: { slideId, partUri: notes.resolvedTarget, region: 'speakerNotes' },
      });
    }
  }
  for (const [prefix, kind] of [
    ['/ppt/slideMasters/', 'master'],
    ['/ppt/slideLayouts/', 'layout'],
    ['/ppt/theme/', 'theme'],
  ] as const)
    for (const part of archive.parts.values())
      if (part.name.startsWith(prefix) && part.name.endsWith('.xml')) {
        const doc = archive.readXml(part.name);
        elements.push({
          ref: { documentId, elementId: `${kind}:${part.name}`, path: part.name, revision: rev },
          kind,
          partUri: part.name,
          text: textOf(doc),
          payload: {
            colors: descendants(doc, 'srgbClr')
              .map((n) => attr(n, 'val'))
              .filter((v): v is string => v !== undefined),
          },
        });
      }
  return { revision: rev, elements };
}
export const findIndexed = (index: IndexFile, ref: ElementRef): IndexedElement | undefined =>
  index.elements.find((e) => e.ref.elementId === ref.elementId || e.ref.path === ref.path);
export function matchesSelector(
  item: IndexedElement,
  selector:
    | string
    | {
        kind?: string | undefined;
        name?: string | undefined;
        text?: string | undefined;
        textRegex?: string | undefined;
        id?: string | undefined;
        slide?: string | undefined;
        hasText?: boolean | string | undefined;
      },
): boolean {
  if (typeof selector === 'string' && (selector === '*' || selector === 'all')) return true;
  const spec: Record<string, string | boolean | undefined> =
    typeof selector === 'string'
      ? selector.includes('=')
        ? Object.fromEntries(
            selector.split(/\s+/).map((part) => {
              const index = part.indexOf('=');
              return [part.slice(0, index), part.slice(index + 1)];
            }),
          )
        : { any: selector }
      : selector;
  if (spec['any'] === '*' || spec['any'] === 'all') return true;
  const contains = (actual: string | undefined, expected: string | undefined): boolean =>
    expected === undefined || (actual?.toLowerCase().includes(expected.toLowerCase()) ?? false);
  const hasTextSpec = spec['hasText'];
  if (hasTextSpec !== undefined) {
    const want =
      typeof hasTextSpec === 'boolean'
        ? hasTextSpec
        : !['0', 'false', 'no'].includes(hasTextSpec.toLowerCase());
    if (Boolean(item.text?.length) !== want) return false;
  }
  const textRegex =
    typeof spec['textRegex'] === 'string'
      ? spec['textRegex']
      : typeof spec['text~'] === 'string'
        ? spec['text~']
        : undefined;
  if (typeof textRegex === 'string') {
    try {
      if (!new RegExp(textRegex, 'u').test(item.text ?? '')) return false;
    } catch {
      return false;
    }
  }
  return (
    contains(item.kind, typeof spec['kind'] === 'string' ? spec['kind'] : undefined) &&
    contains(item.name, typeof spec['name'] === 'string' ? spec['name'] : undefined) &&
    contains(item.text, typeof spec['text'] === 'string' ? spec['text'] : undefined) &&
    contains(item.ref.elementId, typeof spec['id'] === 'string' ? spec['id'] : undefined) &&
    contains(item.slideId, typeof spec['slide'] === 'string' ? spec['slide'] : undefined) &&
    contains(
      [item.kind, item.name, item.text, item.ref.elementId, item.slideId]
        .filter((value): value is string => value !== undefined)
        .join(' '),
      typeof spec['any'] === 'string' ? spec['any'] : undefined,
    )
  );
}
