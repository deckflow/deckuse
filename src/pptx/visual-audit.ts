import type { Diagnostic } from '../core/index.js';
import { measureText } from '../core/measure.js';
import type { OpcArchive } from '../opc/index.js';
import { buildIndex } from './indexer.js';
import { nodeFor } from './node-for.js';
import { readSlideSize } from './slide-size.js';
import { chartRenderDiagnostics } from './render-fidelity.js';
import { descendants, first, NS } from './xml.js';
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
/** Geometric facts and heuristic concerns stay explicitly distinguished. */
export function auditVisuals(archive: OpcArchive, onlyPage?: number): VisualAudit {
  const index = buildIndex(archive, 'audit', '0');
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
    const boxes: { target: string; kind: string; x: number; y: number; w: number; h: number }[] =
      [];
    const doc = archive.readXml(slide.partUri);
    for (const item of items) {
      const target = item.ref.path ?? item.ref.elementId ?? item.name ?? item.kind;
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
      if (bx < -1 || by < -1 || bx + bw > size.widthEmu + 1 || by + bh > size.heightEmu + 1)
        diagnostics.push({
          severity: 'warning',
          code: 'OBJECT_OUT_OF_BOUNDS',
          message: 'Object bounds extend beyond the slide',
          details: {
            page,
            target,
            bounds: { x: bx, y: by, width: bw, height: bh },
            slide: size,
            heuristic: false,
          },
        });
      if (['textbox', 'table', 'chart'].includes(item.kind))
        boxes.push({ target, kind: item.kind, x: bx, y: by, w: bw, h: bh });
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
          if (estimated.heightEmu > h - top - bottom)
            diagnostics.push({
              severity: 'warning',
              code: 'TEXT_OVERFLOW_SUSPECTED',
              message:
                'Estimated text height exceeds the available box; confirm with the rendering engine',
              details: {
                page,
                target,
                estimatedHeight: estimated.heightEmu,
                availableHeight: h - top - bottom,
                heuristic: true,
              },
            });
        }
      }
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
            severity: 'warning',
            code: 'CONTENT_OVERLAP_SUSPECTED',
            message: 'Content objects overlap; confirm whether the overlap is intentional',
            details: { page, targets: [a.target, b.target], overlapArea: dx * dy, heuristic: true },
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
