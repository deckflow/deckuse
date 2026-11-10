import type { Element } from '@xmldom/xmldom';
import type { Diagnostic } from '../core/index.js';
import { measureText } from '../core/measure.js';
import type { OpcArchive } from '../opc/index.js';
import { targetPathForItem } from './addressing.js';
import { buildIndex } from './indexer.js';
import type { IndexFile } from './types.js';
import { nodeFor } from './node-for.js';
import { readSlideSize } from './slide-size.js';
import { chartRenderDiagnostics } from './render-fidelity.js';
import { children, descendants, first, NS } from './xml.js';
export interface ReviewItem {
  target: string;
  page: number;
  reason: string;
  mediaPart?: string;
  evidence: Record<string, unknown>;
}
export interface VisualAudit {
  diagnostics: Diagnostic[];
  reviewItems: ReviewItem[];
  fontVerification: 'unknown';
  nativeVerification: 'unverified';
}
interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

function isUnpaintedTextbox(node: Element): boolean {
  const shapeProperties = children(node);
  const spPr = shapeProperties.find((child) => child.localName === 'spPr');
  const properties = spPr ? children(spPr) : [];
  const line = properties.find((child) => child.localName === 'ln');
  const style = shapeProperties.some((child) => child.localName === 'style');
  const hasFill = properties.some((child) =>
    ['solidFill', 'gradFill', 'pattFill', 'blipFill', 'grpFill'].includes(child.localName ?? ''),
  );
  const unfilled = properties.some((child) => child.localName === 'noFill') || (!style && !hasFill);
  const unoutlined = line ? children(line).some((child) => child.localName === 'noFill') : !style;
  return unfilled && unoutlined && !first(node, 'ph');
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Geometric facts and heuristic concerns stay explicitly distinguished. */
export function auditVisuals(
  archive: OpcArchive,
  onlyPage?: number,
  index: IndexFile = buildIndex(archive, 'audit', '0'),
): VisualAudit {
  const size = readSlideSize(archive);
  const slides = index.elements.filter((e) => e.kind === 'slide');
  const diagnostics: Diagnostic[] = [];
  const reviewItems: ReviewItem[] = [];
  for (const [offset, slide] of slides.entries()) {
    const page = offset + 1;
    if (onlyPage !== undefined && onlyPage !== page) continue;
    diagnostics.push(...chartRenderDiagnostics(archive, page));
    const items = index.elements.filter(
      (e) =>
        e.partUri === slide.partUri &&
        e.kind !== 'slide' &&
        !['tableCell', 'notes'].includes(e.kind),
    );
    const boxes: {
      target: string;
      name: string | undefined;
      sample: string | undefined;
      x: number;
      y: number;
      w: number;
      h: number;
    }[] = [];
    const boundsByTarget = new Map<string, Bounds>();
    const pendingOverflow: { diagnostic: Diagnostic; excessBounds: Bounds[] }[] = [];
    let hasUnknownBounds = false;
    const doc = archive.readXml(slide.partUri);
    for (const item of items) {
      const target = targetPathForItem(index, item);
      const node = nodeFor(doc, item);
      if (item.kind === 'picture') {
        const mediaPart =
          typeof item.payload?.['mediaPart'] === 'string' ? item.payload['mediaPart'] : undefined;
        reviewItems.push({
          target,
          page,
          reason: 'Image content has not been checked against surrounding text or KPIs',
          ...(mediaPart ? { mediaPart } : {}),
          evidence: { name: item.name ?? '', kind: 'picture', classification: 'unreviewed' },
        });
      }
      if (node)
        for (const link of descendants(node, 'blip').filter((n) => n.namespaceURI === NS.a)) {
          const id = link.getAttributeNS(NS.r, 'embed');
          if (
            id &&
            !archive
              .getRelationships(item.partUri)
              .some((r) => r.id === id && r.resolvedTarget && archive.getPart(r.resolvedTarget))
          )
            diagnostics.push({
              severity: 'error',
              code: 'MISSING_IMAGE_RELATIONSHIP',
              message: 'Picture references a missing image relationship or part',
              details: { page, target, id, heuristic: false },
            });
        }
      // Group coordinates and inherited placeholder transforms require renderer evaluation.
      const parent = index.elements.find((p) => p.ref.elementId === item.parentId);
      if (parent?.kind === 'group' || item.kind === 'group') {
        hasUnknownBounds = true;
        diagnostics.push({
          severity: 'info',
          code: 'GROUP_GEOMETRY_UNVERIFIED',
          message: 'Grouped geometry needs rendered review',
          details: { page, target, heuristic: false },
        });
        continue;
      }
      const t = item.transform;
      if (!t) {
        hasUnknownBounds = true;
        if (node && first(node, 'ph'))
          diagnostics.push({
            severity: 'info',
            code: 'INHERITED_GEOMETRY_UNVERIFIED',
            message:
              'Placeholder geometry is inherited from its layout/master; review the rendered slide',
            details: { page, target },
          });
        continue;
      }
      const x = Number(t['x']),
        y = Number(t['y']),
        w = Number(t['width']),
        h = Number(t['height']);
      if (![x, y, w, h].every(Number.isFinite) || w < 0 || h < 0) {
        hasUnknownBounds = true;
        diagnostics.push({
          severity: 'warning',
          code: 'INVALID_GEOMETRY',
          message: 'Object has missing, negative or non-finite geometry',
          details: { page, target, transform: t, heuristic: false },
        });
        continue;
      }
      const radians = (Number(t['rotation'] ?? 0) * Math.PI) / 180;
      const bw = Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians));
      const bh = Math.abs(w * Math.sin(radians)) + Math.abs(h * Math.cos(radians));
      const bx = x + (w - bw) / 2,
        by = y + (h - bh) / 2;
      boundsByTarget.set(target, { x: bx, y: by, w: bw, h: bh });
      if (bx < -1 || by < -1 || bx + bw > size.widthEmu + 1 || by + bh > size.heightEmu + 1)
        diagnostics.push({
          severity: 'warning',
          code: 'OBJECT_OUT_OF_BOUNDS',
          message: 'Object bounds extend beyond the slide',
          details: {
            page,
            target,
            shapeName: item.name,
            sample: item.text?.slice(0, 80),
            bounds: { x: bx, y: by, width: bw, height: bh },
            slide: size,
            excessEmu: {
              left: Math.max(0, -bx),
              top: Math.max(0, -by),
              right: Math.max(0, bx + bw - size.widthEmu),
              bottom: Math.max(0, by + bh - size.heightEmu),
            },
            heuristic: false,
          },
        });
      if (['textbox', 'table', 'chart'].includes(item.kind))
        boxes.push({
          target,
          name: item.name,
          sample: item.text?.slice(0, 80),
          x: bx,
          y: by,
          w: bw,
          h: bh,
        });
      if (item.kind === 'textbox' && item.text && node && w > 0) {
        const sizes = descendants(node, 'rPr')
          .map((n) => Number(n.getAttribute('sz')) / 100)
          .filter((n) => n > 0);
        const body = first(node, 'bodyPr');
        if (sizes.length) {
          const left = Number(body?.getAttribute('lIns') ?? 91440),
            right = Number(body?.getAttribute('rIns') ?? 91440);
          const top = Number(body?.getAttribute('tIns') ?? 45720),
            bottom = Number(body?.getAttribute('bIns') ?? 45720);
          const estimated = measureText({
            text: item.text,
            fontSize: Math.max(...sizes),
            maxWidthEmu: Math.max(1, w - left - right),
          });
          const excess = estimated.heightEmu - (h - top - bottom);
          if (excess <= 0 || (estimated.lines === 1 && excess < estimated.heightEmu / 2)) continue;
          const diagnostic: Diagnostic = {
            severity: 'info',
            code: 'TEXT_OVERFLOW_SUSPECTED',
            message:
              'Estimated text height exceeds the available box; confirm with the rendering engine',
            details: {
              page,
              target,
              shapeName: item.name,
              sample: item.text.slice(0, 80),
              estimatedHeight: estimated.heightEmu,
              availableHeight: h - top - bottom,
              excessHeightEmu: excess,
              heuristic: true,
            },
          };
          const orientation = body?.getAttribute('vert');
          if (
            radians !== 0 ||
            (orientation && orientation !== 'horz') ||
            !isUnpaintedTextbox(node)
          ) {
            diagnostics.push(diagnostic);
            continue;
          }
          const anchor = body?.getAttribute('anchor');
          const anchorOffset = anchor === 'b' ? excess : anchor === 'ctr' ? excess / 2 : 0;
          const textTop = y + top - anchorOffset;
          const textBottom = textTop + estimated.heightEmu;
          const textWidth = Math.max(1, w - left - right);
          const excessBounds: Bounds[] = [];
          if (textTop < y)
            excessBounds.push({ x: x + left, y: textTop, w: textWidth, h: y - textTop });
          if (textBottom > y + h)
            excessBounds.push({ x: x + left, y: y + h, w: textWidth, h: textBottom - y - h });
          pendingOverflow.push({ diagnostic, excessBounds });
        }
      }
    }
    for (const { diagnostic, excessBounds } of pendingOverflow) {
      if (
        hasUnknownBounds ||
        [...boundsByTarget].some(
          ([target, bounds]) =>
            target !== diagnostic.details?.['target'] &&
            excessBounds.some((excess) => intersects(excess, bounds)),
        )
      )
        diagnostics.push(diagnostic);
    }
    for (let i = 0; i < boxes.length; i++)
      for (const b of boxes.slice(i + 1)) {
        const a = boxes[i];
        if (!a) continue;
        const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
          dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        const contained =
          (a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h) ||
          (b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h);
        if (!contained && dx > 0 && dy > 0 && dx * dy > Math.min(a.w * a.h, b.w * b.h) * 0.1)
          diagnostics.push({
            severity: 'info',
            code: 'CONTENT_OVERLAP_SUSPECTED',
            message: 'Content objects overlap; confirm whether the overlap is intentional',
            details: {
              page,
              targets: [a.target, b.target],
              shapeName: a.name,
              sample: a.sample,
              otherShapeName: b.name,
              otherSample: b.sample,
              overlapArea: dx * dy,
              overlapWidthEmu: dx,
              overlapHeightEmu: dy,
              heuristic: true,
            },
          });
      }
  }
  return {
    diagnostics,
    reviewItems,
    fontVerification: 'unknown',
    nativeVerification: 'unverified',
  };
}
