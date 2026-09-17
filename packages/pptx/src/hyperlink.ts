import type { OpcArchive, OpcRelationship } from '@deckflow/deckuse-opc';
import type { Element } from '@xmldom/xmldom';
import { NS, REL, attr, children, cNvPr, first } from './xml.js';

const nextRelId = (rels: readonly OpcRelationship[]): string => {
  const used = new Set(rels.map((r) => r.id));
  let n = 1;
  while (used.has(`rId${String(n)}`)) n++;
  return `rId${String(n)}`;
};

const hlinkRidOf = (hlink: Element): string | undefined =>
  hlink.getAttributeNS(NS.r, 'id') ?? attr(hlink, 'r:id');

/** Read the external hyperlink URL on a shape/picture `cNvPr`, if any. */
export const readHyperlink = (archive: OpcArchive, slidePart: string, node: Element): string | null => {
  const pr = cNvPr(node);
  if (!pr) return null;
  const hlink = children(pr).find((c) => c.localName === 'hlinkClick') ?? first(pr, 'hlinkClick');
  if (!hlink) return null;
  const rid = hlinkRidOf(hlink);
  if (!rid) return null;
  const rel = archive.getRelationships(slidePart).find((r) => r.id === rid);
  return rel?.target ?? null;
};

const removeHlinkClicks = (pr: Element): string[] => {
  const removed: string[] = [];
  for (const child of [...children(pr)]) {
    if (child.localName !== 'hlinkClick') continue;
    const rid = hlinkRidOf(child);
    if (rid) removed.push(rid);
    pr.removeChild(child);
  }
  return removed;
};

const ridStillUsedInDoc = (root: Element, rid: string, except?: Element): boolean => {
  const walk = (node: Element): boolean => {
    if (node !== except) {
      const embed = node.getAttributeNS(NS.r, 'id') ?? attr(node, 'r:id');
      if (embed === rid) return true;
    }
    for (const child of children(node)) if (walk(child)) return true;
    return false;
  };
  return walk(root);
};

/** Set or clear an external click hyperlink on a shape/picture. Pass null/empty to clear. */
export function setHyperlink(
  archive: OpcArchive,
  slidePart: string,
  node: Element,
  url: string | null,
): void {
  const pr = cNvPr(node);
  if (!pr) throw new Error('Element has no cNvPr for hyperlink');
  const doc = node.ownerDocument;
  if (!doc?.documentElement) throw new Error('Element has no document');

  const removedRids = removeHlinkClicks(pr);
  let rels = [...archive.getRelationships(slidePart)];
  for (const rid of removedRids) {
    const rel = rels.find((r) => r.id === rid);
    if (
      rel?.type === REL.hyperlink &&
      rel.external &&
      !ridStillUsedInDoc(doc.documentElement, rid)
    )
      rels = rels.filter((r) => r.id !== rid);
  }

  if (url === null || url === '') {
    archive.setRelationships(slidePart, rels);
    return;
  }

  const rid = nextRelId(rels);
  rels.push({
    id: rid,
    type: REL.hyperlink,
    target: url,
    external: true,
  });
  archive.setRelationships(slidePart, rels);

  const hlink = doc.createElementNS(NS.a, 'a:hlinkClick');
  hlink.setAttributeNS(NS.r, 'r:id', rid);
  pr.appendChild(hlink);
}
