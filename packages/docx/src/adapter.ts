import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  err,
  ok,
  type AtomicCommand,
  type Diagnostic,
  type FormatAdapter,
  type Result,
  type WorkspaceManifest,
} from '@deckflow/deckuse-core';
import { OpcArchive } from '@deckflow/deckuse-opc';
import { isIntegerRevision, nextRevision } from '@deckflow/deckuse-workspace';
import {
  buildIndex,
  collectHits,
  findIndexed,
  locate,
  matchesSelector,
  readDocument,
  resolveItem,
} from './indexer.js';
import { loadIndex } from './index-sync.js';
import { mutate } from './mutations.js';
import { readProperties } from './properties.js';
import type { IndexedElement } from './types.js';
import { DOCUMENT_PART } from './xml.js';
import {
  initializeWorkspace,
  isPackageStale,
  packagePath,
  persistWrite,
  readHistory,
  readManifest,
  repackWorkspace,
  revision,
  sourceDir,
  undoWrites,
  withWriteLock,
} from './workspace.js';

const VERSION = '0.1.0';
const DOCX_LIST = new Set(['paragraphs', 'tables', 'sections', 'styles', 'bookmarks']);
const SLIDE_COMMANDS = new Set([
  'setTransform',
  'xfrmSet',
  'setTableLayout',
  'zMove',
  'alignElements',
  'add',
  'addSlide',
  'setSlideLayout',
  'addShape',
  'replacePicture',
  'duplicate',
]);
const WRITE_TYPES = new Set([
  'setText',
  'replaceText',
  'setProperties',
  'set',
  'remove',
  'addParagraph',
  'addTable',
  'insertBreak',
  'batch',
  'applyTransaction',
]);
const STRUCTURAL_TYPES = new Set(['addParagraph', 'addTable', 'insertBreak', 'remove', 'setText']);

export const docxCapabilities = {
  protocol: '2.0',
  elements: ['paragraph', 'run', 'table', 'tableCell', 'section', 'style', 'bookmark'],
  addressing: {
    paragraph: 'body/p:<n>',
    run: 'body/p:<n>/run:<k>',
    paraId: 'para:<8 hex>',
    bookmark: 'bookmark:<name>',
    table: 'body/table:<n>/row:<r>/cell:<c>/p:<n>',
    style: 'style:<styleId>',
  },
  text: { setText: true, replaceText: true, crossRun: true, paragraphBlocks: true },
  properties: [
    'fontSize',
    'bold',
    'italic',
    'underline',
    'textColor',
    'fontFamily',
    'paragraph.align',
    'paragraph.style',
  ],
  create: { paragraph: true, table: true, pageBreak: true },
  preservation:
    'unknown parts and untouched XML are preserved; styles.xml, numbering, and theme are not rewritten',
  rejected: ['addShape', 'xfrmSet', 'setTransform', 'alignElements', 'zMove', 'addSlide'],
} as const;

const openWorkspaceArchive = async (workspace: string): Promise<OpcArchive> =>
  OpcArchive.openDirectory(sourceDir(workspace));

const validateArchive = (archive: OpcArchive): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  if (!archive.getPart(DOCUMENT_PART)) {
    diagnostics.push({
      severity: 'error',
      code: 'MISSING_DOCUMENT',
      message: 'word/document.xml is missing',
    });
  }
  for (const [source, rels] of archive.relationships) {
    for (const rel of rels) {
      if (!rel.external && rel.resolvedTarget && !archive.getPart(rel.resolvedTarget)) {
        diagnostics.push({
          severity: 'error',
          code: 'BROKEN_RELATIONSHIP',
          message: `Missing target ${rel.resolvedTarget}`,
          details: { source, relationshipId: rel.id },
        });
      }
    }
  }
  const document = readDocument(archive);
  if (document) {
    const seen = new Set<string>();
    for (const hit of collectHits(archive)) {
      if (hit.kind !== 'paragraph' || !hit.paraId) continue;
      if (seen.has(hit.paraId)) {
        diagnostics.push({
          severity: 'error',
          code: 'DUPLICATE_PARAID',
          message: `Duplicate w14:paraId ${hit.paraId}`,
          details: { paraId: hit.paraId },
        });
      }
      seen.add(hit.paraId);
    }
  }
  return diagnostics;
};

const assertExpectRevision = (
  command: { transactionId?: string; expectRevision?: string | number | undefined },
  current: string,
): Result<never> | undefined => {
  if (command.expectRevision !== undefined) {
    const expected = String(command.expectRevision);
    if (expected !== current && expected !== 'latest')
      return err('TRANSACTION_CONFLICT', `Expected revision ${expected}, current ${current}`);
  }
  if (
    command.transactionId !== undefined &&
    command.transactionId !== current &&
    command.transactionId !== 'latest'
  )
    return err('TRANSACTION_CONFLICT', `Expected transactionId ${current}`);
  return undefined;
};

const listItems = (index: ReturnType<typeof buildIndex>, resource: string) => {
  const kind =
    resource === 'paragraphs'
      ? 'paragraph'
      : resource === 'tables'
        ? 'table'
        : resource === 'sections'
          ? 'section'
          : resource === 'styles'
            ? 'style'
            : resource === 'bookmarks'
              ? 'bookmark'
              : undefined;
  if (!kind) return [];
  return index.elements
    .filter((item) => item.kind === kind)
    .map((item) => ({
      target: item.ref.path,
      uid: item.ref.elementId,
      kind: item.kind,
      ...(item.name ? { name: item.name } : {}),
      ...(item.text ? { textPreview: item.text.slice(0, 80) } : {}),
      ...(item.payload?.['paraId'] ? { paraId: item.payload['paraId'] } : {}),
      ...(item.payload?.['style'] ? { style: item.payload['style'] } : {}),
      protected: item.payload?.['protected'] === true,
      partUri: item.partUri,
    }));
};

const summary = (item: IndexedElement) => ({
  target: item.ref.path,
  uid: item.ref.elementId,
  kind: item.kind,
  ...(item.name ? { name: item.name } : {}),
  ...(item.text ? { text: item.text.slice(0, 200) } : {}),
});

export const docxAdapter: FormatAdapter = {
  format: 'docx',
  version: VERSION,
  async init(command) {
    try {
      const workspace = resolve(command.workspaceId);
      const archive = await OpcArchive.openFile(resolve(command.source));
      if (!archive.getPart(DOCUMENT_PART)) return err('VALIDATION_FAILED', 'Not a DOCX document');
      const created = new Date().toISOString();
      const rev = revision();
      const manifest: WorkspaceManifest = {
        schemaVersion: '2.0',
        workspaceId: workspace,
        format: 'docx',
        source: resolve(command.source),
        revision: rev,
        createdAt: created,
        updatedAt: created,
        adapterVersion: VERSION,
        files: [],
        metadata: { capabilities: docxCapabilities },
      };
      const index = buildIndex(archive, workspace, rev);
      const saved = await initializeWorkspace(workspace, archive, manifest, index);
      return ok({
        workspaceId: saved.workspaceId,
        format: saved.format,
        source: saved.source,
        revision: saved.revision,
        elementCount: index.elements.length,
      });
    } catch (cause) {
      return err('IO_ERROR', cause instanceof Error ? cause.message : 'DOCX init failed');
    }
  },
  async execute(command) {
    const workspace = resolve(command.workspaceId);
    try {
      if (command.type === 'undo') {
        return await withWriteLock(workspace, async () => {
          try {
            return ok(await undoWrites(workspace, command.steps));
          } catch (cause) {
            return err('VALIDATION_FAILED', cause instanceof Error ? cause.message : 'Undo failed');
          }
        });
      }
      if (command.type === 'history') {
        const { records, total } = await readHistory(workspace, command.limit, command.offset);
        const slide = command.slide;
        const filtered =
          slide !== undefined ? records.filter((record) => record.slides.includes(slide)) : records;
        return ok({
          records: filtered,
          total: slide !== undefined ? filtered.length : total,
        });
      }

      const manifest = await readManifest(workspace);
      const schemaVersion = manifest.schemaVersion as string;
      if (schemaVersion !== '2.0' || !isIntegerRevision(manifest.revision)) {
        if (command.type === 'status') {
          return ok({
            workspaceId: workspace,
            format: manifest.format,
            revision: manifest.revision,
            schemaVersion: manifest.schemaVersion,
            compatible: false,
            hint: 'Re-run deckuse init to upgrade this workspace to protocol 2.0.',
            capabilities: manifest.metadata?.['capabilities'],
          });
        }
      }

      const archive = await openWorkspaceArchive(workspace);
      const index = await loadIndex(workspace, archive, manifest, { persist: true });

      if (command.type === 'status') {
        return ok({
          workspaceId: workspace,
          format: manifest.format,
          revision: manifest.revision,
          schemaVersion: manifest.schemaVersion,
          compatible: true,
          adapterVersion: manifest.adapterVersion,
          source: manifest.source,
          package: packagePath(workspace),
          packageStale: await isPackageStale(workspace, manifest),
          elementCount: index.elements.length,
          capabilities: docxCapabilities,
          branch: 'main',
        });
      }

      if (command.type === 'list') {
        if (!DOCX_LIST.has(command.resource)) {
          return err(
            'UNSUPPORTED_CAPABILITY',
            `list ${command.resource} is not available for DOCX`,
            [],
            { hint: 'Use paragraphs, tables, sections, styles, or bookmarks.' },
          );
        }
        return ok({ resource: command.resource, items: listItems(index, command.resource) });
      }

      if (command.type === 'get' || command.type === 'inspect') {
        if (command.type === 'inspect' && !command.target && !command.ref) {
          return ok({
            document: { format: 'docx', revision: index.revision, capabilities: docxCapabilities },
            elements: index.elements.map(summary),
          });
        }
        if (command.type === 'inspect' && command.ref && !command.target) {
          const item = findIndexed(index, command.ref);
          return item
            ? ok(summary(item))
            : err('ELEMENT_NOT_FOUND', 'Element reference was not found');
        }
        const target = command.type === 'get' ? command.target : command.target;
        if (!target) return err('INVALID_COMMAND', 'Missing target');
        const resolved = resolveItem(index, target);
        if (!resolved.ok) return resolved;
        const located = locate(archive, index, target);
        if (!located.ok) return located;
        const details = readProperties(located.value.element, resolved.value.kind);
        return ok({
          target: resolved.value.ref.path,
          uid: resolved.value.ref.elementId,
          kind: resolved.value.kind,
          ...(resolved.value.name ? { name: resolved.value.name } : {}),
          text: resolved.value.text ?? '',
          partUri: resolved.value.partUri,
          properties: details,
          ...(command.type === 'inspect' && command.visualTree
            ? {
                visualTree: index.elements
                  .filter((item) => item.partUri === resolved.value.partUri)
                  .map(summary),
              }
            : {}),
        });
      }

      if (command.type === 'search') {
        if (command.kind === 'shape') {
          return err('UNSUPPORTED_CAPABILITY', 'DOCX has no shapes', [], {
            hint: 'Search text, or list bookmarks.',
          });
        }
        const items = index.elements.filter((item) => {
          if (item.kind !== 'paragraph' && item.kind !== 'tableCell' && item.kind !== 'bookmark')
            return false;
          if (command.name && item.name !== command.name) return false;
          if (
            command.query &&
            !(item.text ?? '').toLowerCase().includes(command.query.toLowerCase())
          )
            return false;
          return true;
        });
        return ok({ matches: items.slice(0, command.limit).map(summary) });
      }

      if (command.type === 'query') {
        return ok(
          index.elements
            .filter((item) => matchesSelector(item, command.selector))
            .slice(0, command.limit)
            .map(summary),
        );
      }

      if (command.type === 'getText') {
        const item = findIndexed(index, command.ref);
        return item
          ? ok({
              ref: item.ref,
              target: item.ref.path,
              uid: item.ref.elementId,
              text: item.text ?? '',
              kind: item.kind,
            })
          : err('ELEMENT_NOT_FOUND', 'Element reference was not found');
      }

      if (command.type === 'validate') {
        const diagnostics = validateArchive(archive);
        return diagnostics.length
          ? err('VALIDATION_FAILED', 'DOCX validation failed', diagnostics)
          : ok({ valid: true, revision: index.revision, capabilities: docxCapabilities });
      }

      if (command.type === 'export') {
        if (command.revision !== undefined && String(command.revision) !== manifest.revision) {
          return err(
            'UNSUPPORTED_CAPABILITY',
            'Export of historical revisions is not available',
            [],
            { hint: 'Omit --revision to export the current workspace package.' },
          );
        }
        const output = resolve(command.output);
        const fromPackage = command.fromPackage === true;
        let repacked = false;
        let exportRevision = manifest.revision;
        if (!fromPackage) {
          const packed = await repackWorkspace(workspace);
          exportRevision = packed.manifest.revision;
          repacked = true;
        }
        await copyFile(packagePath(workspace), output);
        return ok({ output, revision: exportRevision, repacked, fromPackage });
      }

      if (SLIDE_COMMANDS.has(command.type)) {
        return err('UNSUPPORTED_CAPABILITY', `${command.type} is a slide command`, [], {
          hint: 'Word documents are a flow, not a slide canvas. Use addParagraph, addTable, insertBreak, setText, or setProperties.',
        });
      }

      if (!WRITE_TYPES.has(command.type))
        return err('INVALID_COMMAND', `Unsupported command type: ${command.type}`);

      if (command.type === 'applyTransaction') {
        return err(
          'UNSUPPORTED_CAPABILITY',
          'DOCX apply does not accept low-level transaction ops',
          [],
          {
            hint: 'Use high-level commands with "type": "addParagraph" | "setText" | "replaceText".',
          },
        );
      }

      const conflict = assertExpectRevision(command, manifest.revision);
      if (conflict) return conflict;

      return await withWriteLock(workspace, async () => {
        const currentManifest = await readManifest(workspace);
        const locked = assertExpectRevision(command, currentManifest.revision);
        if (locked) return locked;
        const working = await openWorkspaceArchive(workspace);
        let currentIndex = await loadIndex(workspace, working, currentManifest);

        const runBatch = async (
          nestedCommands: AtomicCommand[],
          dryRun: boolean | undefined,
          operation: unknown,
        ) => {
          const results: unknown[] = [];
          const diagnostics: Diagnostic[] = [];
          const changedTargets: string[] = [];
          const changedParts: string[] = [];
          for (const nested of nestedCommands) {
            const result = mutate(nested, working, currentIndex);
            diagnostics.push(...result.diagnostics);
            if (!result.ok) return result;
            results.push(result.value);
            if (result.value.changedTargets) changedTargets.push(...result.value.changedTargets);
            if (result.value.changedParts) changedParts.push(...result.value.changedParts);
            if (STRUCTURAL_TYPES.has(nested.type)) {
              currentIndex = buildIndex(
                working,
                currentManifest.workspaceId,
                currentManifest.revision,
              );
            }
          }
          const validation = validateArchive(working);
          if (validation.length)
            return err('VALIDATION_FAILED', 'DOCX validation failed', validation);
          if (dryRun) {
            return ok(
              {
                results,
                revision: currentManifest.revision,
                dryRun: true,
                changedTargets: [...new Set(changedTargets)],
                changedParts: [...new Set(changedParts)],
                affectedSlides: [],
              },
              diagnostics,
            );
          }
          const rev = nextRevision(currentManifest.revision);
          const nextIndex = buildIndex(working, currentManifest.workspaceId, rev);
          const saved = await persistWrite(
            workspace,
            working,
            currentManifest,
            nextIndex,
            operation,
            [],
          );
          return ok(
            {
              results,
              revision: saved.revision,
              changedTargets: [...new Set(changedTargets)],
              changedParts: [...new Set(changedParts)],
              affectedSlides: [],
            },
            diagnostics,
          );
        };

        if (command.type === 'batch') return runBatch(command.commands, command.dryRun, command);

        const result = mutate(command, working, currentIndex);
        if (!result.ok) return result;
        const validation = validateArchive(working);
        if (validation.length)
          return err('VALIDATION_FAILED', 'DOCX validation failed', validation);
        if (command.dryRun) {
          return ok(
            {
              ...result.value,
              revision: currentManifest.revision,
              dryRun: true,
              affectedSlides: [],
            },
            result.diagnostics,
          );
        }
        const rev = nextRevision(currentManifest.revision);
        const nextIndex = buildIndex(working, currentManifest.workspaceId, rev);
        const saved = await persistWrite(
          workspace,
          working,
          currentManifest,
          nextIndex,
          command,
          [],
        );
        return ok(
          { ...result.value, revision: saved.revision, affectedSlides: [] },
          result.diagnostics,
        );
      });
    } catch (cause) {
      return err('IO_ERROR', cause instanceof Error ? cause.message : 'DOCX operation failed');
    }
  },
};
