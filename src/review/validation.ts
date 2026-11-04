import type { Diagnostic } from '../core/index.js';
import type { OpcArchive } from '../opc/index.js';
import { all, relatedPart, root } from './xml.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const M = 'http://schemas.microsoft.com/office/powerpoint/2018/8/main';
const COMMENT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const MODERN = 'http://schemas.microsoft.com/office/2018/10/relationships/comments';
export const validateReviewParts = (archive: OpcArchive, format: 'docx' | 'pptx'): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const report = (
    code: string,
    message: string,
    partUri: string,
    severity: 'warning' | 'error' = 'error',
  ) => diagnostics.push({ severity, code, message, details: { partUri } });
  const globalIds = new Set<string>();
  const owners = new Map<string, string>();
  for (const [source, rels] of archive.relationships)
    for (const rel of rels) {
      if (
        ![COMMENT, MODERN].includes(rel.type) ||
        !rel.resolvedTarget ||
        !archive.getPart(rel.resolvedTarget)
      )
        continue;
      const part = rel.resolvedTarget,
        doc = archive.readXml(part);
      const ns = root(doc).namespaceURI;
      if (format === 'docx') {
        if (ns !== W || root(doc).localName !== 'comments') {
          report('INVALID_COMMENTS_ROOT', 'Expected Word comments root', part);
          continue;
        }
        const ids = new Set<string>();
        const paragraphs = new Set<string>();
        for (const c of all(doc, W, 'comment')) {
          const id = c.getAttributeNS(W, 'id');
          if (!id || ids.has(id))
            report('DUPLICATE_COMMENT_ID', 'Missing or duplicate Word comment ID', part);
          if (id) ids.add(id);
          for (const p of all(c, W, 'p')) {
            const id = p.getAttributeNS(W14, 'paraId');
            if (id) {
              if (paragraphs.has(id))
                report('DUPLICATE_COMMENT_PARAID', 'Duplicate comment paragraph ID', part);
              paragraphs.add(id);
            }
          }
        }
        const extPart = relatedPart(
          archive,
          source,
          'http://schemas.microsoft.com/office/2011/relationships/commentsExtended',
          '/word/commentsExtended.xml',
        );
        if (archive.getPart(extPart)) {
          const ext = archive.readXml(extPart);
          const parents = new Map<string, string>();
          for (const ex of all(ext, W15, 'commentEx')) {
            const id = ex.getAttributeNS(W15, 'paraId'),
              parent = ex.getAttributeNS(W15, 'paraIdParent');
            if (!id || !paragraphs.has(id))
              report(
                'ORPHAN_COMMENT_EXTENSION',
                'Comment extension has no paragraph',
                extPart,
                'warning',
              );
            if (id && parent) parents.set(id, parent);
            if (parent && !paragraphs.has(parent))
              report('ORPHAN_COMMENT_PARENT', 'Reply parent is missing', extPart, 'warning');
          }
          for (const id of parents.keys()) {
            const visited = new Set<string>();
            let current: string | undefined = id;
            while (current) {
              if (visited.has(current)) {
                report('COMMENT_THREAD_CYCLE', 'Comment thread contains a cycle', extPart);
                break;
              }
              visited.add(current);
              current = parents.get(current);
            }
          }
        }
        for (const [story, data] of archive.parts) {
          if (
            !story.startsWith('/word/') ||
            !data.mediaType.includes('xml') ||
            story.endsWith('.rels')
          )
            continue;
          const xml = archive.readXml(story);
          const starts = new Set<string>(),
            ends = new Set<string>();
          for (const n of all(xml, W)) {
            const type = n.localName ?? '';
            if (!['commentRangeStart', 'commentRangeEnd', 'commentReference'].includes(type))
              continue;
            const id = n.getAttributeNS(W, 'id') ?? '';
            if (!ids.has(id))
              report(
                'ORPHAN_COMMENT_REFERENCE',
                'Comment anchor references an absent comment',
                story,
              );
            if (type === 'commentRangeStart') {
              if (starts.has(id))
                report('DUPLICATE_COMMENT_ANCHOR', 'Duplicate comment start', story);
              starts.add(id);
            }
            if (type === 'commentRangeEnd') {
              if (ends.has(id)) report('DUPLICATE_COMMENT_ANCHOR', 'Duplicate comment end', story);
              ends.add(id);
            }
          }
          for (const id of new Set([...starts, ...ends]))
            if (starts.has(id) !== ends.has(id))
              report('UNPAIRED_COMMENT_ANCHOR', 'Comment range is incomplete', story);
        }
      } else {
        if (![P, M].includes(ns ?? '') || root(doc).localName !== 'cmLst') {
          report('INVALID_COMMENTS_ROOT', 'Expected PowerPoint comments root', part);
          continue;
        }
        const previous = owners.get(part);
        if (previous && previous !== source)
          report('SHARED_COMMENTS_PART', 'Slides share a mutable comments part', part);
        owners.set(part, source);
        const modern = ns === M;
        const authorRel = modern
          ? 'http://schemas.microsoft.com/office/2018/10/relationships/authors'
          : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors';
        const authorPart = relatedPart(
          archive,
          '/ppt/presentation.xml',
          authorRel,
          modern ? '/ppt/authors.xml' : '/ppt/commentAuthors.xml',
        );
        const authors = archive.getPart(authorPart)
          ? new Set(
              all(archive.readXml(authorPart), modern ? M : P, modern ? 'author' : 'cmAuthor').map(
                (n) => n.getAttribute('id'),
              ),
            )
          : new Set<string>();
        for (const c of all(doc, modern ? M : P).filter(
          (n) => n.localName === 'cm' || (modern && n.localName === 'reply'),
        )) {
          const aid = c.getAttribute('authorId');
          if (!aid || !authors.has(aid))
            report('MISSING_COMMENT_AUTHOR', 'Comment author is absent', part);
          const id = modern ? c.getAttribute('id') : `${aid ?? ''}/${c.getAttribute('idx') ?? ''}`;
          const key = `${modern ? 'modern' : 'legacy'}:${id ?? ''}`;
          if (!id || (!modern && !/^\d+\/\d+$/.test(id)) || globalIds.has(key))
            report('DUPLICATE_COMMENT_ID', 'Missing or duplicate presentation comment ID', part);
          globalIds.add(key);
          if (
            modern &&
            c.getAttribute('status') &&
            !['active', 'resolved', 'closed'].includes(c.getAttribute('status') ?? '')
          )
            report('UNKNOWN_COMMENT_STATUS', 'Comment status is not supported', part, 'warning');
        }
      }
    }
  return diagnostics;
};
