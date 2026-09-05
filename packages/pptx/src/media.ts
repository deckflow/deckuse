import { readFile } from 'node:fs/promises';
import { extname, posix } from 'node:path';
import { err, ok, type Result } from '@deckflow/deckuse-core';
import { OpcArchive, type OpcRelationship } from '@deckflow/deckuse-opc';
import type { Document, Element } from '@xmldom/xmldom';
import { cleanupUnreferencedPart } from './picture.js';
import { NS, REL, attr, descendants, first } from './xml.js';

const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const MEDIA_EXT_URI = '{DAA4B4D4-6D71-4841-9C94-3AE86A117CC2}';

/** 1×1 opaque gray PNG used as video/audio poster when none is provided. */
const PLACEHOLDER_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const esc = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

const nextRid = (rels: readonly OpcRelationship[]) => {
  let n = 1;
  const ids = new Set(rels.map((r) => r.id));
  while (ids.has(`rId${String(n)}`)) n++;
  return `rId${String(n)}`;
};

const relativeTarget = (source: string, target: string): string =>
  posix.relative(posix.dirname(source), target).replace(/^\//, '');

const nextMediaPart = (archive: OpcArchive, prefix: string, ext: string) => {
  let n = 1;
  while (archive.getPart(`/ppt/media/${prefix}${String(n)}${ext}`)) n++;
  return `/ppt/media/${prefix}${String(n)}${ext}`;
};

const mediaMime = (ext: string, kind: 'video' | 'audio'): string => {
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.avi': 'video/x-msvideo',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.wma': 'audio/x-ms-wma',
    '.ogg': 'audio/ogg',
  };
  return map[ext] ?? (kind === 'video' ? 'video/mp4' : 'audio/mpeg');
};

export async function addMediaPart(
  archive: OpcArchive,
  slidePart: string,
  input: { path: string; kind: 'video' | 'audio' },
): Promise<
  Result<{ mediaPart: string; mediaRid: string; fileRid: string; posterRid: string }>
> {
  let data: Uint8Array;
  try {
    data = await readFile(input.path);
  } catch (cause) {
    return err(
      'IO_ERROR',
      cause instanceof Error ? cause.message : `Failed to read ${input.kind} path`,
    );
  }
  const ext = extname(input.path).toLowerCase() || (input.kind === 'video' ? '.mp4' : '.mp3');
  const mediaPart = nextMediaPart(archive, 'media', ext);
  archive.setPart(mediaPart, data, mediaMime(ext, input.kind));

  const posterPart = nextMediaPart(archive, 'image', '.png');
  archive.setPart(posterPart, PLACEHOLDER_PNG, 'image/png');

  const rels = [...archive.getRelationships(slidePart)];
  const fileRid = nextRid(rels);
  const fileType = input.kind === 'video' ? REL.video : REL.audio;
  rels.push({
    id: fileRid,
    type: fileType,
    target: relativeTarget(slidePart, mediaPart),
    external: false,
    resolvedTarget: mediaPart,
  });
  const mediaRid = nextRid(rels);
  rels.push({
    id: mediaRid,
    type: REL.media,
    target: relativeTarget(slidePart, mediaPart),
    external: false,
    resolvedTarget: mediaPart,
  });
  const posterRid = nextRid(rels);
  rels.push({
    id: posterRid,
    type: REL.image,
    target: relativeTarget(slidePart, posterPart),
    external: false,
    resolvedTarget: posterPart,
  });
  archive.setRelationships(slidePart, rels);
  return ok({ mediaPart, mediaRid, fileRid, posterRid });
}

export function mediaPicXml(
  id: number,
  e: Record<string, unknown>,
  kind: 'video' | 'audio',
  fileRid: string,
  mediaRid: string,
  posterRid: string,
): string {
  const name =
    typeof e['name'] === 'string' && e['name'].length > 0
      ? e['name']
      : `${kind === 'video' ? 'Video' : 'Audio'} ${String(id)}`;
  const x = typeof e['x'] === 'number' ? e['x'] : 0;
  const y = typeof e['y'] === 'number' ? e['y'] : 0;
  const width = typeof e['width'] === 'number' ? e['width'] : 914400 * 4;
  const height = typeof e['height'] === 'number' ? e['height'] : 914400 * 3;
  const fileTag =
    kind === 'video'
      ? `<a:videoFile r:link="${fileRid}"/>`
      : `<a:audioFile r:link="${fileRid}"/>`;
  return `<p:pic xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p14="${P14}"><p:nvPicPr><p:cNvPr id="${String(id)}" name="${esc(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr>${fileTag}<p:extLst><p:ext uri="${MEDIA_EXT_URI}"><p14:media r:embed="${mediaRid}"/></p:ext></p:extLst></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="${posterRid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${String(x)}" y="${String(y)}"/><a:ext cx="${String(width)}" cy="${String(height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

const mediaFileRid = (node: Element): string | undefined => {
  const video = first(node, 'videoFile');
  const audio = first(node, 'audioFile');
  const el = video ?? audio;
  return el?.getAttributeNS(NS.r, 'link') ?? attr(el, 'r:link') ?? undefined;
};

const mediaEmbedRid = (node: Element): string | undefined => {
  for (const media of descendants(node, 'media')) {
    const embed = media.getAttributeNS(NS.r, 'embed') ?? attr(media, 'r:embed');
    if (embed) return embed;
  }
  return undefined;
};

const posterEmbedRid = (node: Element): string | undefined => {
  const blip = first(node, 'blip');
  return blip?.getAttributeNS(NS.r, 'embed') ?? attr(blip, 'r:embed') ?? undefined;
};

const ridStillUsed = (doc: Document, rid: string): boolean => {
  const walk = (node: Element): boolean => {
    for (const name of ['embed', 'link']) {
      if (node.getAttributeNS(NS.r, name) === rid || node.getAttribute(`r:${name}`) === rid)
        return true;
    }
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1 && walk(child as Element)) return true;
    }
    return false;
  };
  return doc.documentElement ? walk(doc.documentElement) : false;
};

export function detachMediaAndCleanup(
  archive: OpcArchive,
  slidePart: string,
  doc: Document,
  mediaNode: Element,
): void {
  const rids = [mediaFileRid(mediaNode), mediaEmbedRid(mediaNode), posterEmbedRid(mediaNode)].filter(
    (rid): rid is string => typeof rid === 'string',
  );
  const rels = archive.getRelationships(slidePart);
  const mediaParts = rids
    .map((rid) => rels.find((r) => r.id === rid)?.resolvedTarget)
    .filter((part): part is string => typeof part === 'string');
  mediaNode.parentNode?.removeChild(mediaNode);
  const keep = new Set(rids.filter((rid) => ridStillUsed(doc, rid)));
  archive.setRelationships(
    slidePart,
    rels.filter((item) => !rids.includes(item.id) || keep.has(item.id)),
  );
  for (const part of new Set(mediaParts)) cleanupUnreferencedPart(archive, part);
}
