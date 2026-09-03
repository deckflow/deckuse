import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from '@xmldom/xmldom';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';

export interface OpcLimits {
  readonly maxEntries: number;
  readonly maxEntrySize: number;
  readonly maxTotalSize: number;
}
export const DEFAULT_OPC_LIMITS: OpcLimits = {
  maxEntries: 10_000,
  maxEntrySize: 256 * 1024 * 1024,
  maxTotalSize: 1024 * 1024 * 1024,
};
export interface OpcPart {
  readonly name: string;
  mediaType: string;
  data: Uint8Array;
}
export interface OpcRelationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
  readonly resolvedTarget?: string;
}
export interface ContentTypes {
  readonly defaults: Map<string, string>;
  readonly overrides: Map<string, string>;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const XML_DANGEROUS = /<!DOCTYPE|<!ENTITY/i;
export const normalizePartName = (name: string): string => {
  if (name.includes('\0')) throw new Error('OPC part name contains NUL');
  const slash = name.replaceAll(/\\+/g, '/');
  const segments = slash.split('/');
  if (segments.some((segment) => segment === '..'))
    throw new Error('OPC part name cannot escape package root');
  return `/${segments.filter((segment) => segment && segment !== '.').join('/')}`;
};
export type XmlDocument = Document & { documentElement: Element };
export const parseXml = (input: string | Uint8Array): XmlDocument => {
  const xml = typeof input === 'string' ? input : decoder.decode(input);
  if (XML_DANGEROUS.test(xml)) throw new Error('XML DTD and entities are not allowed');
  let error = '';
  const document = new DOMParser({
    errorHandler: (level: string, message: string) => {
      if (level !== 'warning') error ||= message;
    },
  }).parseFromString(xml, 'application/xml');
  if (error || document.getElementsByTagName('parsererror').length)
    throw new Error(`Invalid XML: ${error || 'parser error'}`);
  if (!document.documentElement) throw new Error('Invalid XML: missing document element');
  return document as XmlDocument;
};
const isXmlPart = (part: OpcPart): boolean =>
  part.mediaType.includes('xml') || part.name.endsWith('.xml') || part.name.endsWith('.rels');

/**
 * Pretty-print XML for readable git diffs without changing the infoset.
 *
 * Rules:
 * - Never inject or strip character data inside text nodes (e.g. `a:t`).
 * - Elements with direct text / mixed content stay on one line (exact join).
 * - Empty or whitespace-only text elements stay inline (`<a:t> </a:t>` preserved).
 * - Only element-only children get newline + indent; inter-element whitespace is dropped.
 */
export const prettyPrintXml = (source: string): string => {
  const trimmed = source.trim();
  if (!trimmed) return '\n';

  const tokens = trimmed.match(/<[^>]+>|[^<]+/g);
  if (!tokens) return `${trimmed}\n`;

  const isClose = (t: string) => t.startsWith('</');
  const isPiOrDecl = (t: string) => t.startsWith('<?') || t.startsWith('<!');
  const isSelfClosing = (t: string) => /^<[^!?/][^>]*\/>$/.test(t);
  const isOpen = (t: string) =>
    t.startsWith('<') && !isClose(t) && !isPiOrDecl(t) && !isSelfClosing(t);
  const isText = (t: string) => !t.startsWith('<');
  const isWsText = (t: string) => isText(t) && /^\s*$/.test(t);

  const findClose = (openIdx: number): number => {
    let depth = 0;
    for (let j = openIdx; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (isOpen(t)) depth += 1;
      else if (isClose(t)) {
        depth -= 1;
        if (depth === 0) return j;
      }
    }
    return -1;
  };

  /** Classify direct content of tokens[openIdx..closeIdx]. */
  const classify = (openIdx: number, closeIdx: number): 'elements' | 'preserve' => {
    let depth = 0;
    let hasElement = false;
    let hasSignificantText = false;
    let hasWsOnlyText = false;
    for (let j = openIdx + 1; j < closeIdx; j++) {
      const t = tokens[j]!;
      if (isOpen(t)) {
        if (depth === 0) hasElement = true;
        depth += 1;
      } else if (isSelfClosing(t)) {
        if (depth === 0) hasElement = true;
      } else if (isClose(t)) {
        depth -= 1;
      } else if (isText(t) && depth === 0) {
        if (isWsText(t)) hasWsOnlyText = true;
        else hasSignificantText = true;
      }
    }
    // Mixed content, leaf text, or ws-only text leaf: keep exact character data.
    if (hasSignificantText || hasWsOnlyText) return 'preserve';
    if (hasElement) return 'elements';
    // Truly empty `<tag></tag>` — keep inline so we don't invent a text node.
    return 'preserve';
  };

  const lines: string[] = [];

  const emitElement = (openIdx: number, closeIdx: number, indent: number): void => {
    const pad = '  '.repeat(indent);
    const open = tokens[openIdx]!;
    const close = tokens[closeIdx]!;
    if (classify(openIdx, closeIdx) === 'preserve') {
      lines.push(`${pad}${tokens.slice(openIdx, closeIdx + 1).join('')}`);
      return;
    }
    lines.push(`${pad}${open}`);
    let j = openIdx + 1;
    while (j < closeIdx) {
      const t = tokens[j]!;
      if (isWsText(t)) {
        j += 1;
        continue;
      }
      if (isPiOrDecl(t) || isSelfClosing(t)) {
        lines.push(`${'  '.repeat(indent + 1)}${t}`);
        j += 1;
        continue;
      }
      if (isOpen(t)) {
        const childClose = findClose(j);
        if (childClose === -1 || childClose > closeIdx) {
          lines.push(`${'  '.repeat(indent + 1)}${t}`);
          j += 1;
          continue;
        }
        emitElement(j, childClose, indent + 1);
        j = childClose + 1;
        continue;
      }
      // Unexpected token inside element-only content — preserve without indent injection.
      if (isText(t)) {
        lines.push(t);
        j += 1;
        continue;
      }
      j += 1;
    }
    lines.push(`${pad}${close}`);
  };

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (isPiOrDecl(token) || isSelfClosing(token)) {
      lines.push(token);
      i += 1;
      continue;
    }
    if (isOpen(token)) {
      const closeIdx = findClose(i);
      if (closeIdx === -1) {
        lines.push(token);
        i += 1;
        continue;
      }
      emitElement(i, closeIdx, 0);
      i = closeIdx + 1;
      continue;
    }
    if (isText(token)) {
      if (!isWsText(token)) lines.push(token);
      i += 1;
      continue;
    }
    if (isClose(token)) {
      lines.push(token);
      i += 1;
      continue;
    }
    i += 1;
  }

  return `${lines.join('\n')}\n`;
};

export const formatXmlBytes = (data: Uint8Array): Uint8Array => {
  try {
    return encoder.encode(prettyPrintXml(decoder.decode(data)));
  } catch {
    return data;
  }
};

export const serializeXml = (document: Node): Uint8Array =>
  formatXmlBytes(encoder.encode(new XMLSerializer().serializeToString(document)));

export const relationshipPartName = (source: string): string => {
  if (source === '/') return '/_rels/.rels';
  const normalized = normalizePartName(source);
  return `${posix.dirname(normalized)}/_rels/${posix.basename(normalized)}.rels`;
};
export const resolveRelationshipTarget = (source: string, target: string): string => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
  const decoded = decodeURIComponent(target.split('#')[0] ?? target);
  const base = source === '/' ? '/' : `${posix.dirname(normalizePartName(source))}/`;
  return normalizePartName(posix.resolve(base, decoded));
};
const attr = (element: Element, name: string): string => element.getAttribute(name) ?? '';

export class OpcArchive {
  readonly parts = new Map<string, OpcPart>();
  readonly relationships = new Map<string, OpcRelationship[]>();
  readonly contentTypes: ContentTypes = { defaults: new Map(), overrides: new Map() };
  readonly originalDigests = new Map<string, string>();

  static async openDirectory(path: string, limitsInput: Partial<OpcLimits> = {}): Promise<OpcArchive> {
    const limits = { ...DEFAULT_OPC_LIMITS, ...limitsInput };
    const archive = new OpcArchive();
    let total = 0;
    const walk = async (dir: string, prefix = ''): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolute, relative);
          continue;
        }
        if (!entry.isFile()) continue;
        if (archive.parts.size >= limits.maxEntries)
          throw new Error(`OPC entry limit exceeded: ${String(archive.parts.size)}`);
        const name = normalizePartName(`/${relative.replaceAll('\\', '/')}`);
        if (archive.parts.has(name)) throw new Error(`Duplicate OPC entry: ${name}`);
        const data = await readFile(absolute);
        if (data.length > limits.maxEntrySize) throw new Error(`OPC entry too large: ${name}`);
        total += data.length;
        if (total > limits.maxTotalSize) throw new Error('OPC total uncompressed size limit exceeded');
        archive.parts.set(name, { name, mediaType: 'application/octet-stream', data });
        archive.originalDigests.set(name, createHash('sha256').update(data).digest('hex'));
      }
    };
    await walk(resolve(path));
    if (!archive.parts.size) throw new Error('OPC directory is empty');
    archive.loadMetadata();
    return archive;
  }
  static async openFile(path: string, limits: Partial<OpcLimits> = {}): Promise<OpcArchive> {
    return OpcArchive.open(await readFile(path), limits);
  }
  static async open(bytes: Uint8Array, limitsInput: Partial<OpcLimits> = {}): Promise<OpcArchive> {
    const limits = { ...DEFAULT_OPC_LIMITS, ...limitsInput };
    const archive = new OpcArchive();
    const reader = new ZipReader(new Uint8ArrayReader(bytes));
    try {
      const entries = await reader.getEntries();
      if (entries.length > limits.maxEntries)
        throw new Error(`ZIP entry limit exceeded: ${String(entries.length)}`);
      let total = 0;
      for (const entry of entries) {
        if (entry.directory) continue;
        const name = normalizePartName(entry.filename);
        if (name.slice(1) !== entry.filename.replaceAll('\\', '/'))
          throw new Error(`Unsafe ZIP entry path: ${entry.filename}`);
        if (archive.parts.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
        if (entry.uncompressedSize > limits.maxEntrySize)
          throw new Error(`ZIP entry too large: ${name}`);
        total += entry.uncompressedSize;
        if (total > limits.maxTotalSize)
          throw new Error('ZIP total uncompressed size limit exceeded');
        const data = await entry.getData(new Uint8ArrayWriter());
        if (data.length > limits.maxEntrySize) throw new Error(`ZIP entry too large: ${name}`);
        archive.parts.set(name, { name, mediaType: 'application/octet-stream', data });
        archive.originalDigests.set(name, createHash('sha256').update(data).digest('hex'));
      }
    } finally {
      await reader.close();
    }
    archive.loadMetadata();
    return archive;
  }
  private loadMetadata(): void {
    const ct = this.parts.get('/[Content_Types].xml');
    if (!ct) throw new Error('OPC package is missing [Content_Types].xml');
    const ctDoc = parseXml(ct.data);
    for (const node of Array.from(ctDoc.documentElement.childNodes)) {
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      if (element.localName === 'Default')
        this.contentTypes.defaults.set(
          attr(element, 'Extension').toLowerCase(),
          attr(element, 'ContentType'),
        );
      if (element.localName === 'Override')
        this.contentTypes.overrides.set(
          normalizePartName(attr(element, 'PartName')),
          attr(element, 'ContentType'),
        );
    }
    for (const part of this.parts.values()) {
      part.mediaType =
        this.contentTypes.overrides.get(part.name) ??
        this.contentTypes.defaults.get(posix.extname(part.name).slice(1).toLowerCase()) ??
        'application/octet-stream';
      if (!part.name.endsWith('.rels')) continue;
      const source =
        part.name === '/_rels/.rels'
          ? '/'
          : normalizePartName(part.name.replace('/_rels/', '/').replace(/\.rels$/, ''));
      const doc = parseXml(part.data);
      const rels: OpcRelationship[] = [];
      for (const node of Array.from(doc.documentElement.childNodes))
        if (node.nodeType === 1) {
          const element = node as Element;
          const external = attr(element, 'TargetMode').toLowerCase() === 'external';
          const target = attr(element, 'Target');
          rels.push({
            id: attr(element, 'Id'),
            type: attr(element, 'Type'),
            target,
            external,
            ...(external ? {} : { resolvedTarget: resolveRelationshipTarget(source, target) }),
          });
        }
      this.relationships.set(source, rels);
    }
  }
  getPart(name: string): OpcPart | undefined {
    return this.parts.get(normalizePartName(name));
  }
  readXml(name: string): Document {
    const part = this.getPart(name);
    if (!part) throw new Error(`OPC part not found: ${name}`);
    return parseXml(part.data);
  }
  writeXml(name: string, document: Node, mediaType?: string): void {
    this.setPart(name, serializeXml(document), mediaType);
  }
  setPart(name: string, data: Uint8Array, mediaType = 'application/octet-stream'): void {
    const normalized = normalizePartName(name);
    this.parts.set(normalized, { name: normalized, mediaType, data });
    if (mediaType !== 'application/octet-stream')
      this.contentTypes.overrides.set(normalized, mediaType);
  }
  deletePart(name: string): boolean {
    const normalized = normalizePartName(name);
    this.contentTypes.overrides.delete(normalized);
    this.relationships.delete(normalized);
    this.parts.delete(relationshipPartName(normalized));
    return this.parts.delete(normalized);
  }
  originalDigest(name: string): string | undefined {
    return this.originalDigests.get(normalizePartName(name));
  }
  isUnmodified(name: string): boolean {
    const normalized = normalizePartName(name);
    const original = this.originalDigests.get(normalized);
    const part = this.parts.get(normalized);
    return (
      original !== undefined &&
      part !== undefined &&
      createHash('sha256').update(part.data).digest('hex') === original
    );
  }
  getRelationships(source = '/'): readonly OpcRelationship[] {
    return this.relationships.get(normalizePartName(source)) ?? [];
  }
  setRelationships(source: string, relationships: readonly OpcRelationship[]): void {
    const normalized = source === '/' ? '/' : normalizePartName(source);
    this.relationships.set(normalized, [...relationships]);
    const doc = parseXml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    );
    for (const relationship of relationships) {
      const element = doc.createElementNS(doc.documentElement.namespaceURI, 'Relationship');
      element.setAttribute('Id', relationship.id);
      element.setAttribute('Type', relationship.type);
      element.setAttribute('Target', relationship.target);
      if (relationship.external) element.setAttribute('TargetMode', 'External');
      doc.documentElement.appendChild(element);
    }
    this.setPart(
      relationshipPartName(normalized),
      serializeXml(doc),
      'application/vnd.openxmlformats-package.relationships+xml',
    );
  }
  private syncContentTypes(): void {
    const doc = parseXml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    );
    for (const [extension, contentType] of [...this.contentTypes.defaults].sort()) {
      const element = doc.createElementNS(doc.documentElement.namespaceURI, 'Default');
      element.setAttribute('Extension', extension);
      element.setAttribute('ContentType', contentType);
      doc.documentElement.appendChild(element);
    }
    for (const [partName, contentType] of [...this.contentTypes.overrides].sort()) {
      if (!this.parts.has(partName)) continue;
      const element = doc.createElementNS(doc.documentElement.namespaceURI, 'Override');
      element.setAttribute('PartName', partName);
      element.setAttribute('ContentType', contentType);
      doc.documentElement.appendChild(element);
    }
    this.parts.set('/[Content_Types].xml', {
      name: '/[Content_Types].xml',
      mediaType: 'application/xml',
      data: serializeXml(doc),
    });
  }
  async toUint8Array(): Promise<Uint8Array> {
    this.syncContentTypes();
    const writer = new Uint8ArrayWriter();
    const zip = new ZipWriter(writer, { bufferedWrite: true, keepOrder: true, level: 6 });
    for (const part of this.parts.values())
      await zip.add(part.name.slice(1), new Uint8ArrayReader(part.data));
    return zip.close();
  }
  async writeDirectory(path: string, overwrite = false): Promise<void> {
    const destination = resolve(path);
    if (!overwrite) {
      try {
        await stat(destination);
        throw new Error(`Destination exists: ${destination}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      for (const part of this.parts.values()) {
        const file = resolve(temporary, part.name.slice(1));
        await mkdir(dirname(file), { recursive: true });
        const data = isXmlPart(part) ? formatXmlBytes(part.data) : part.data;
        await writeFile(file, data);
      }
      await rm(destination, { recursive: true, force: true });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }
  async writeFile(path: string, overwrite = false): Promise<void> {
    const destination = resolve(path);
    await mkdir(dirname(destination), { recursive: true });
    if (!overwrite) {
      try {
        await readFile(destination);
        throw new Error(`Destination exists: ${destination}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, await this.toUint8Array(), { flag: 'wx' });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}

export async function snapshotArchive(
  archive: OpcArchive,
  outputPath: string,
): Promise<{ checksum: string }> {
  await archive.writeFile(outputPath, true);
  const bytes = await readFile(resolve(outputPath));
  return { checksum: createHash('sha256').update(bytes).digest('hex') };
}
