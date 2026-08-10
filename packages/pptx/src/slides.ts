import { posix } from 'node:path';
import { OpcArchive, type OpcRelationship } from '@deckflow/deckuse-opc';
import { cleanupUnreferencedPart } from './picture.js';
import { NS, REL, attr, descendants, first } from './xml.js';
const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
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
  const list = first(doc, 'sldIdLst');
  if (!list) throw new Error('presentation.xml has no sldIdLst');
  return { doc, list, rels: [...archive.getRelationships('/ppt/presentation.xml')] };
};
export function addSlide(archive: OpcArchive, templatePart?: string, layoutPart?: string): string {
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
  sld.setAttribute(
    'id',
    String(
      Math.max(255, ...descendants(doc, 'sldId').map((n) => Number(attr(n, 'id') ?? 255))) + 1,
    ),
  );
  sld.setAttributeNS(NS.r, 'r:id', rid);
  list.appendChild(sld);
  archive.writeXml(
    '/ppt/presentation.xml',
    doc,
    archive.getPart('/ppt/presentation.xml')?.mediaType,
  );
  return part;
}
export function duplicateSlide(archive: OpcArchive, part: string): string {
  return addSlide(archive, part);
}
export function removeSlide(archive: OpcArchive, part: string): void {
  const { doc, list, rels } = presentationState(archive);
  const rel = rels.find((r) => r.resolvedTarget === part);
  if (!rel) throw new Error(`Slide not registered: ${part}`);
  const node = descendants(list, 'sldId').find(
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
  archive.writeXml(
    '/ppt/presentation.xml',
    doc,
    archive.getPart('/ppt/presentation.xml')?.mediaType,
  );
}
export function slideElementPart(refPart: string): string {
  return refPart.split('#')[0] ?? refPart;
}
