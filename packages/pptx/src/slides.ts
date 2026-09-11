import { posix } from 'node:path';
import { OpcArchive, type OpcRelationship } from '@deckflow/deckuse-opc';
import { cleanupUnreferencedPart } from './picture.js';
import { NS, REL, attr, descendants } from './xml.js';
import type { Element, Node } from '@xmldom/xmldom';
const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const NOTES_CT = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';
const EP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';
const nextNumber = (archive: OpcArchive, prefix: string): number =>
  Math.max(
    0,
    ...[...archive.parts.keys()]
      .filter((n) => n.startsWith(prefix))
      .map((n) => Number(/(\d+)\.xml$/.exec(n)?.[1] ?? 0)),
  ) + 1;
const relativeTarget = (source: string, target: string): string =>
  posix.relative(posix.dirname(source), target).replace(/^\//, '');
const nextRelId = (rels: readonly OpcRelationship[]): string => {
  const used = new Set(rels.map((r) => r.id));
  let n = 1;
  while (used.has(`rId${String(n)}`)) n++;
  return `rId${String(n)}`;
};

/**
 * `p:sldId` entries in `p:sldIdLst` only.
 *
 * Decks with sections also carry `p14:sldId` under `p14:sectionLst`. Those share
 * the local name `sldId` but must not be counted as slides — doing so makes
 * `docProps/app.xml` `<Slides>` wrong and PowerPoint prompts to repair.
 *
 * Accepts either the presentation document or the `p:sldIdLst` element itself
 * (`descendants` does not include the root node).
 */
const presentationSlideIds = (node: Node): Element[] => {
  const el = node as Element;
  const list =
    el.nodeType === 1 && el.localName === 'sldIdLst' && el.namespaceURI === NS.p
      ? el
      : descendants(node, 'sldIdLst').find((item) => item.namespaceURI === NS.p);
  if (!list) return [];
  return descendants(list, 'sldId').filter((item) => item.namespaceURI === NS.p);
};

/** Keep docProps/app.xml Slides/Notes in sync with the package (PowerPoint repairs on mismatch). */
const syncAppSlideCounts = (archive: OpcArchive): void => {
  const part = archive.getPart('/docProps/app.xml');
  if (!part) return;
  const slideCount = presentationSlideIds(archive.readXml('/ppt/presentation.xml')).length;
  let notesCount = 0;
  for (const [slidePart, rels] of archive.relationships) {
    if (!slidePart.startsWith('/ppt/slides/')) continue;
    if (rels.some((r) => r.type === REL.notes)) notesCount++;
  }
  const app = archive.readXml('/docProps/app.xml');
  let dirty = false;
  for (const [localName, value] of [
    ['Slides', String(slideCount)],
    ['Notes', String(notesCount)],
  ] as const) {
    const el = descendants(app, localName).find(
      (node) => !node.namespaceURI || node.namespaceURI === EP_NS,
    );
    if (!el) continue;
    if ((el.textContent ?? '') === value) continue;
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(app.createTextNode(value));
    dirty = true;
  }
  if (dirty) archive.writeXml('/docProps/app.xml', app, part.mediaType);
};

/** Create a notes slide part for `slidePart` when missing; return the notes part URI. */
export function ensureNotes(archive: OpcArchive, slidePart: string): string {
  const existing = archive.getRelationships(slidePart).find((r) => r.type === REL.notes);
  if (existing?.resolvedTarget && archive.getPart(existing.resolvedTarget))
    return existing.resolvedTarget;

  const number = nextNumber(archive, '/ppt/notesSlides/');
  const part = `/ppt/notesSlides/notesSlide${String(number)}.xml`;
  archive.setPart(
    part,
    new TextEncoder().encode(
      `<p:notes xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t></a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
    ),
    NOTES_CT,
  );
  archive.setRelationships(part, [
    {
      id: 'rId1',
      type: REL.slide,
      target: relativeTarget(part, slidePart),
      external: false,
      resolvedTarget: slidePart,
    },
  ]);
  const rels = [...archive.getRelationships(slidePart)];
  const rid = nextRelId(rels);
  rels.push({
    id: rid,
    type: REL.notes,
    target: relativeTarget(slidePart, part),
    external: false,
    resolvedTarget: part,
  });
  archive.setRelationships(slidePart, rels);
  return part;
}
const cloneMutableTargets = (
  archive: OpcArchive,
  sourcePart: string,
  newPart: string,
): OpcRelationship[] =>
  archive.getRelationships(sourcePart).map((rel) => {
    if (rel.external || !rel.resolvedTarget) return rel;
    if (rel.type !== REL.chart && rel.type !== REL.notes)
      return { ...rel, resolvedTarget: rel.resolvedTarget };
    const old = rel.resolvedTarget;
    const folder = rel.type === REL.chart ? '/ppt/charts/' : '/ppt/notesSlides/';
    const fresh = `${folder}${rel.type === REL.chart ? 'chart' : 'notesSlide'}${String(nextNumber(archive, folder))}.xml`;
    const part = archive.getPart(old);
    if (part) archive.setPart(fresh, part.data.slice(), part.mediaType);
    const childRels = archive.getRelationships(old);
    if (childRels.length)
      archive.setRelationships(
        fresh,
        childRels.map((child) => ({
          ...child,
          target:
            child.external || !child.resolvedTarget
              ? child.target
              : relativeTarget(fresh, child.resolvedTarget),
        })),
      );
    return { ...rel, target: relativeTarget(newPart, fresh), resolvedTarget: fresh };
  });
const presentationState = (archive: OpcArchive) => {
  const doc = archive.readXml('/ppt/presentation.xml');
  const list = descendants(doc, 'sldIdLst').find((el) => el.namespaceURI === NS.p);
  if (!list) throw new Error('presentation.xml has no sldIdLst');
  return { doc, list, rels: [...archive.getRelationships('/ppt/presentation.xml')] };
};
export function addSlide(
  archive: OpcArchive,
  templatePart?: string,
  layoutPart?: string,
  afterIndex?: number,
): string {
  const { doc, list, rels } = presentationState(archive);
  const number = nextNumber(archive, '/ppt/slides/');
  const part = `/ppt/slides/slide${String(number)}.xml`;
  if (templatePart) {
    const template = archive.getPart(templatePart);
    if (!template) throw new Error(`Template slide missing: ${templatePart}`);
    archive.setPart(part, template.data.slice(), SLIDE_CT);
    archive.setRelationships(
      part,
      cloneMutableTargets(archive, templatePart, part).map((rel) => ({
        ...rel,
        target:
          rel.external || !rel.resolvedTarget
            ? rel.target
            : relativeTarget(part, rel.resolvedTarget),
      })),
    );
  } else {
    archive.setPart(
      part,
      new TextEncoder().encode(
        `<p:sld xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
      ),
      SLIDE_CT,
    );
    if (layoutPart)
      archive.setRelationships(part, [
        {
          id: 'rId1',
          type: REL.layout,
          target: relativeTarget(part, layoutPart),
          external: false,
          resolvedTarget: layoutPart,
        },
      ]);
  }
  const rid = nextRelId(rels);
  rels.push({
    id: rid,
    type: REL.slide,
    target: relativeTarget('/ppt/presentation.xml', part),
    external: false,
    resolvedTarget: part,
  });
  archive.setRelationships('/ppt/presentation.xml', rels);
  const sld = doc.createElementNS(NS.p, 'p:sldId');
  const existing = presentationSlideIds(list);
  sld.setAttribute(
    'id',
    String(Math.max(255, ...existing.map((n) => Number(attr(n, 'id') ?? 255))) + 1),
  );
  sld.setAttributeNS(NS.r, 'r:id', rid);
  // Insert after the given 1-based slide index; append when omitted / out of range.
  const anchor =
    afterIndex !== undefined && afterIndex > 0 ? existing[afterIndex - 1] : undefined;
  if (anchor?.nextSibling) list.insertBefore(sld, anchor.nextSibling);
  else if (anchor) list.appendChild(sld);
  else list.appendChild(sld);
  archive.writeXml('/ppt/presentation.xml', doc);
  syncAppSlideCounts(archive);
  return part;
}
export function duplicateSlide(archive: OpcArchive, part: string): string {
  return addSlide(archive, part);
}
export function removeSlide(archive: OpcArchive, part: string): void {
  const { doc, list, rels } = presentationState(archive);
  const rel = rels.find((r) => r.resolvedTarget === part);
  if (!rel) throw new Error(`Slide not registered: ${part}`);
  const node = presentationSlideIds(list).find(
    (n) => (n.getAttributeNS(NS.r, 'id') ?? attr(n, 'r:id')) === rel.id,
  );
  node?.parentNode?.removeChild(node);
  archive.setRelationships(
    '/ppt/presentation.xml',
    rels.filter((r) => r.id !== rel.id),
  );
  const targets = archive
    .getRelationships(part)
    .filter(
      (r) =>
        !r.external &&
        r.resolvedTarget &&
        (r.type === REL.chart || r.type === REL.notes || r.type === REL.image),
    )
    .flatMap((r) => (r.resolvedTarget ? [r.resolvedTarget] : []));
  archive.deletePart(part);
  for (const target of targets) cleanupUnreferencedPart(archive, target);
  archive.writeXml('/ppt/presentation.xml', doc);
  syncAppSlideCounts(archive);
}
export function slideElementPart(refPart: string): string {
  return refPart.split('#')[0] ?? refPart;
}
