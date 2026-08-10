import { readFile } from 'node:fs/promises';
import { extname, posix } from 'node:path';
import { err, ok, type Result } from '@deckflow/deckuse-core';
import { OpcArchive, type OpcRelationship } from '@deckflow/deckuse-opc';
import type { Document, Element } from '@xmldom/xmldom';
import { NS, REL, attr, descendants, first } from './xml.js';

const mediaType = (extension: string) =>
  extension === '.png'
    ? 'image/png'
    : extension === '.gif'
      ? 'image/gif'
      : extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : 'application/octet-stream';

const nextMedia = (archive: OpcArchive, ext: string) => {
  let n = 1;
  while (archive.getPart(`/ppt/media/image${String(n)}${ext}`)) n++;
  return `/ppt/media/image${String(n)}${ext}`;
};

const nextRid = (rels: readonly OpcRelationship[]) => {
  let n = 1;
  const ids = new Set(rels.map((r) => r.id));
  while (ids.has(`rId${String(n)}`)) n++;
  return `rId${String(n)}`;
};

const relativeTarget = (source: string, target: string): string =>
  posix.relative(posix.dirname(source), target).replace(/^\//, '');

export const isPartReferenced = (archive: OpcArchive, target: string): boolean =>
  [...archive.relationships.values()].some((items) =>
    items.some((rel) => rel.resolvedTarget === target),
  );

export const cleanupUnreferencedPart = (archive: OpcArchive, target: string): boolean => {
  if (isPartReferenced(archive, target)) return false;
  return archive.deletePart(target);
};

const embedIdUsed = (doc: Document, rid: string): boolean =>
  descendants(doc, 'blip').some((blip) => {
    const embed = blip.getAttributeNS(NS.r, 'embed') ?? attr(blip, 'r:embed');
    return embed === rid;
  });

export const pictureEmbedId = (node: Element): string | undefined => {
  const blip = first(node, 'blip');
  return blip?.getAttributeNS(NS.r, 'embed') ?? attr(blip, 'r:embed') ?? undefined;
};

export async function loadPictureBytes(input: {
  path?: string;
  base64?: string;
}): Promise<Result<{ data: Uint8Array; ext: string }>> {
  if (typeof input.path === 'string') {
    try {
      const data = await readFile(input.path);
      return ok({ data, ext: extname(input.path).toLowerCase() || '.png' });
    } catch (cause) {
      return err('IO_ERROR', cause instanceof Error ? cause.message : 'Failed to read picture path');
    }
  }
  if (typeof input.base64 === 'string') {
    const data = Buffer.from(input.base64.replace(/^data:[^,]+,/, ''), 'base64');
    const match = /^data:image\/(png|jpeg|gif)/.exec(input.base64);
    const ext = match?.[1] ? (match[1] === 'jpeg' ? '.jpg' : `.${match[1]}`) : '.png';
    return ok({ data, ext });
  }
  return err('INVALID_COMMAND', 'Picture requires path or base64');
}

export async function addPicturePart(
  archive: OpcArchive,
  slidePart: string,
  input: { path?: string; base64?: string },
): Promise<Result<{ target: string; rid: string }>> {
  const loaded = await loadPictureBytes(input);
  if (!loaded.ok) return loaded;
  const target = nextMedia(archive, loaded.value.ext);
  archive.setPart(target, loaded.value.data, mediaType(loaded.value.ext));
  const rels = [...archive.getRelationships(slidePart)];
  const rid = nextRid(rels);
  rels.push({
    id: rid,
    type: REL.image,
    target: relativeTarget(slidePart, target),
    external: false,
    resolvedTarget: target,
  });
  archive.setRelationships(slidePart, rels);
  return ok({ target, rid });
}

export function replacePictureMedia(
  archive: OpcArchive,
  slidePart: string,
  pictureNode: Element,
  data: Uint8Array,
  ext: string,
): Result<{ mediaPart: string }> {
  const rid = pictureEmbedId(pictureNode);
  if (!rid)
    return err('INVALID_COMMAND', 'Picture has no embedded image relationship (r:embed)');
  const rels = [...archive.getRelationships(slidePart)];
  const index = rels.findIndex((rel) => rel.id === rid);
  const current = index >= 0 ? rels[index] : undefined;
  if (!current) return err('INVALID_COMMAND', `Missing image relationship ${rid}`);
  if (current.external || !current.resolvedTarget)
    return err('INVALID_COMMAND', 'Cannot replace externally linked pictures');
  const previous = current.resolvedTarget;
  const previousExt = extname(previous).toLowerCase();
  if (previousExt === ext) {
    archive.setPart(previous, data, mediaType(ext));
    return ok({ mediaPart: previous });
  }
  const target = nextMedia(archive, ext);
  archive.setPart(target, data, mediaType(ext));
  rels[index] = {
    ...current,
    target: relativeTarget(slidePart, target),
    resolvedTarget: target,
  };
  archive.setRelationships(slidePart, rels);
  cleanupUnreferencedPart(archive, previous);
  return ok({ mediaPart: target });
}

export function detachPictureAndCleanup(
  archive: OpcArchive,
  slidePart: string,
  doc: Document,
  pictureNode: Element,
): void {
  const rid = pictureEmbedId(pictureNode);
  const rel = rid
    ? archive.getRelationships(slidePart).find((item) => item.id === rid)
    : undefined;
  const mediaPart = rel?.resolvedTarget;
  pictureNode.parentNode?.removeChild(pictureNode);
  if (rid && !embedIdUsed(doc, rid)) {
    archive.setRelationships(
      slidePart,
      archive.getRelationships(slidePart).filter((item) => item.id !== rid),
    );
  }
  if (mediaPart) cleanupUnreferencedPart(archive, mediaPart);
}
