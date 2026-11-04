import { slideComments } from './comments.js';
import { refreshConnectors, affectedShapeIds } from './connectors.js';
import type { Element } from '@xmldom/xmldom';
import { err, ok, type AtomicCommand } from '../core/index.js';
import type { OpcArchive } from '../opc/index.js';
import { requireDefined as need } from '../required.js';
import { resolveTarget, stableUid } from './addressing.js';
import { nodeFor } from './node-for.js';
import { addElement, buildMergeMap } from './elements.js';
import { readBBox, writeBBox } from './align.js';
import { NS, children, first, descendants, cNvPr } from './xml.js';
import type { IndexFile } from './types.js';
const shapes = (node: Element) =>
  children(node).filter((n) =>
    ['sp', 'pic', 'grpSp', 'cxnSp', 'graphicFrame'].includes(n.localName ?? ''),
  );
export async function structuralMutation(
  command: Extract<
    AtomicCommand,
    { type: 'groupShapes' | 'ungroupShapes' | 'mergeTableCells' | 'unmergeTableCells' }
  >,
  archive: OpcArchive,
  index: IndexFile,
) {
  try {
    const target = command.type === 'groupShapes' ? need(command.targets[0]) : command.target;
    const resolved = resolveTarget(index, target);
    if (!resolved.ok) return resolved;
    if (!/^\/ppt\/slides\/[^/]+\.xml$/.test(resolved.value.item.partUri))
      throw new Error('STRUCTURE_SLIDE_TARGET_REQUIRED');
    const part = resolved.value.item.partUri,
      doc = archive.readXml(part);
    const node = need(nodeFor(doc, resolved.value.item));
    const changedIds = affectedShapeIds(node);
    const identities = (nodes: Element[]) =>
      nodes.map((n) => ({
        id: need(cNvPr(n)).getAttribute('id'),
        uid: stableUid({
          documentId: resolved.value.item.ref.documentId,
          partUri: part,
          cNvPrId: need(cNvPr(n)).getAttribute('id') ?? '',
          kind:
            n.localName === 'grpSp'
              ? 'group'
              : n.localName === 'cxnSp'
                ? 'connector'
                : n.localName === 'pic'
                  ? 'picture'
                  : n.localName === 'graphicFrame'
                    ? first(n, 'tbl')
                      ? 'table'
                      : 'chart'
                    : 'textbox',
        }),
        target: `slide:${String(resolved.value.slidePage)}/shape:${need(cNvPr(n)).getAttribute('id') ?? ''}`,
      }));
    let result: Record<string, unknown> = {};
    if (command.type === 'groupShapes') {
      if (command.slide !== resolved.value.slidePage) throw new Error('GROUP_WRONG_SLIDE');
      const nodes = command.targets.map((t) => {
        const r = resolveTarget(index, t);
        if (!r.ok) throw new Error(r.error.message);
        if (r.value.item.partUri !== part) throw new Error('GROUP_CROSS_SLIDE');
        return need(nodeFor(doc, r.value.item));
      });
      const parent = need(node.parentNode) as Element;
      if (new Set(nodes).size !== nodes.length || nodes.some((n) => n.parentNode !== parent))
        throw new Error('GROUP_REQUIRES_DISTINCT_SIBLINGS');
      const siblings = shapes(parent),
        ordered = siblings.filter((n) => nodes.includes(n));
      if (ordered.length !== nodes.length) throw new Error('GROUP_UNSUPPORTED_TARGET');
      const positions = ordered.map((n) => siblings.indexOf(n));
      if (
        command.zOrder === 'preserve' &&
        Math.max(...positions) - Math.min(...positions) + 1 !== nodes.length
      )
        throw new Error('GROUP_NONCONTIGUOUS_Z_ORDER');
      for (const n of ordered) for (const id of affectedShapeIds(n)) changedIds.add(id);
      const boxes = ordered.map((n) => need(readBBox(n)));
      const x = Math.min(...boxes.map((b) => b.x)),
        y = Math.min(...boxes.map((b) => b.y));
      const width = Math.max(1, ...boxes.map((b) => b.x + b.width - x)),
        height = Math.max(1, ...boxes.map((b) => b.y + b.height - y));
      const group = await addElement(archive, part, doc, parent, {
        kind: 'group',
        x,
        y,
        width,
        height,
        name: command.name ?? 'Group',
      });
      parent.insertBefore(
        group,
        command.zOrder === 'front'
          ? null
          : command.zOrder === 'back'
            ? need(siblings[0])
            : need(ordered[0]),
      );
      const xfrm = need(first(group, 'xfrm'));
      need(first(xfrm, 'chOff')).setAttribute('x', String(x));
      need(first(xfrm, 'chOff')).setAttribute('y', String(y));
      for (const n of ordered) group.appendChild(n);
      result = { group: identities([group])[0], children: identities(ordered) };
    } else if (command.type === 'ungroupShapes') {
      if (node.localName !== 'grpSp') throw new Error('UNGROUP_REQUIRES_GROUP');
      const groupId = need(cNvPr(node)).getAttribute('id');
      if (descendants(doc, 'spTgt').some((t) => t.getAttribute('spid') === groupId))
        throw new Error('UNGROUP_ANIMATION_TARGET_UNSUPPORTED');
      if (
        slideComments(archive).some(
          (c) =>
            c.anchor['partUri'] === part &&
            (c.anchor['shapeId'] === groupId || c.anchor['status'] === 'unresolved'),
        )
      )
        throw new Error('UNGROUP_COMMENT_ANCHOR_UNSUPPORTED');
      const xf = need(first(node, 'xfrm')),
        box = need(readBBox(node));
      if (children(need(first(node, 'grpSpPr'))).some((n) => n.localName !== 'xfrm'))
        throw new Error('UNGROUP_GROUP_EFFECTS_UNSUPPORTED');
      const off = need(first(xf, 'chOff')),
        ext = need(first(xf, 'chExt'));
      const sx = box.width / Number(ext.getAttribute('cx')),
        sy = box.height / Number(ext.getAttribute('cy'));
      if (![sx, sy].every((v) => Number.isFinite(v) && v > 0))
        throw new Error('UNGROUP_INVALID_TRANSFORM');
      // Nonuniform scaling of rotated children creates shear and cannot be flattened losslessly.
      if (descendants(node, 'grpFill').length)
        throw new Error('UNGROUP_INHERITED_FILL_UNSUPPORTED');
      const kids = shapes(node),
        plans = kids.map((child) => {
          if (
            (sx !== 1 || sy !== 1) &&
            descendants(child, 'txBody').some((body) =>
              descendants(body, 't').some((t) => t.textContent),
            )
          )
            throw new Error('UNGROUP_SCALED_TEXT_REQUIRES_FONT_MATERIALIZATION');
          const b = need(readBBox(child)),
            cx = need(first(child, 'xfrm'));
          if (Math.abs(sx - sy) > 1e-9 && Number(cx.getAttribute('rot') ?? 0) % 10800000 !== 0)
            throw new Error('UNGROUP_SHEAR_UNSUPPORTED');
          const rot = (Number(xf.getAttribute('rot') ?? 0) * Math.PI) / 10800000;
          const flipH = xf.getAttribute('flipH') === '1',
            flipV = xf.getAttribute('flipV') === '1';
          let dx = (b.x + b.width / 2 - Number(off.getAttribute('x'))) * sx - box.width / 2;
          let dy = (b.y + b.height / 2 - Number(off.getAttribute('y'))) * sy - box.height / 2;
          if (flipH) dx = -dx;
          if (flipV) dy = -dy;
          const width = b.width * sx,
            height = b.height * sy;
          return {
            child,
            cx,
            width,
            height,
            x: box.x + box.width / 2 + dx * Math.cos(rot) - dy * Math.sin(rot) - width / 2,
            y: box.y + box.height / 2 + dx * Math.sin(rot) + dy * Math.cos(rot) - height / 2,
            rotation:
              Number(xf.getAttribute('rot') ?? 0) +
              (flipH !== flipV ? -1 : 1) * Number(cx.getAttribute('rot') ?? 0),
            flipH,
            flipV,
          };
        });
      for (const p of plans) {
        writeBBox(p.child, p);
        p.cx.setAttribute('rot', String(p.rotation));
        for (const key of ['flipH', 'flipV'] as const)
          p.cx.setAttribute(key, p[key] !== (p.cx.getAttribute(key) === '1') ? '1' : '0');
        need(node.parentNode).insertBefore(p.child, node);
      }
      need(node.parentNode).removeChild(node);
      result = { children: identities(kids) };
    } else {
      const table = need(first(node, 'tbl')),
        rows = children(table).filter((n) => n.localName === 'tr');
      const parse = (v: string) => {
        const m = /^(\d+):(\d+)$/.exec(v);
        if (!m) throw new Error('TABLE_INVALID_RANGE');
        return [Number(m[1]), Number(m[2])] as const;
      };
      const [r1, c1] = parse(command.from),
        [r2, c2] = parse(command.to);
      if (r2 < r1 || c2 < c1 || r2 >= rows.length) throw new Error('TABLE_RANGE_OUT_OF_BOUNDS');
      const grid = rows.map((r) => children(r).filter((c) => c.localName === 'tc'));
      if (grid.some((row) => c2 >= row.length)) throw new Error('TABLE_RANGE_OUT_OF_BOUNDS');
      // Validate all existing merge rectangles; partial overlap is always unsafe.
      for (let r = 0; r < grid.length; r++)
        for (let c = 0; c < need(grid[r]).length; c++) {
          const cell = need(need(grid[r])[c]);
          const re = r + Number(cell.getAttribute('rowSpan') ?? 1) - 1,
            ce = c + Number(cell.getAttribute('gridSpan') ?? 1) - 1;
          if (re === r && ce === c) continue;
          if (
            r <= r2 &&
            re >= r1 &&
            c <= c2 &&
            ce >= c1 &&
            !(r >= r1 && re <= r2 && c >= c1 && ce <= c2)
          )
            throw new Error('TABLE_PARTIAL_MERGE_OVERLAP');
          if (command.type === 'mergeTableCells' && r <= r2 && re >= r1 && c <= c2 && ce >= c1)
            throw new Error('TABLE_ALREADY_MERGED');
        }
      const anchor = need(need(grid[r1])[c1]),
        body = need(first(anchor, 'txBody'));
      if (command.type === 'mergeTableCells' && command.content === 'requireEmpty')
        for (let r = r1; r <= r2; r++)
          for (let c = c1; c <= c2; c++)
            if (
              (r !== r1 || c !== c1) &&
              descendants(need(need(grid[r])[c]), 't').some((t) => t.textContent)
            )
              throw new Error('TABLE_MERGE_CONTENT_NOT_EMPTY');
      const mergeMap = buildMergeMap(
        [{ from: command.from, to: command.to }],
        rows.length,
        need(grid[0]).length,
      );
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++) {
          const cell = need(need(grid[r])[c]);
          for (const a of ['gridSpan', 'rowSpan', 'hMerge', 'vMerge']) cell.removeAttribute(a);
          if (command.type === 'mergeTableCells') {
            for (const [key, value] of Object.entries(
              mergeMap.get(`${String(r)}:${String(c)}`) ?? {},
            ))
              cell.setAttribute(key, typeof value === 'boolean' ? '1' : String(value));
            if ((r !== r1 || c !== c1) && command.content === 'append') {
              const source = need(first(cell, 'txBody'));
              for (const para of children(source).filter((p) => p.localName === 'p'))
                body.appendChild(para);
              source.appendChild(doc.createElementNS(NS.a, 'a:p'));
            }
          }
        }
    }
    refreshConnectors(doc, 'detach', changedIds);
    archive.writeXml(part, doc);
    return ok({
      changed: true,
      slides: resolved.value.slidePage ? [resolved.value.slidePage] : [],
      changedParts: [part],
      ...result,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err('INVALID_COMMAND', message, [
      {
        severity: 'error',
        code: /^[A-Z][A-Z_]+/.exec(message)?.[0] ?? 'NATIVE_STRUCTURE_UNSUPPORTED',
        message,
        details: {
          ...('target' in command
            ? { target: command.target }
            : { slide: command.slide, targets: command.targets }),
        },
      },
    ]);
  }
}
