import { resolve } from 'node:path';
import {
  err,
  ok,
  type Diagnostic,
  type FormatAdapter,
  type WorkspaceManifest,
} from '@deckflow/deckuse-core';
import { OpcArchive } from '@deckflow/deckuse-opc';
import { buildIndex, findIndexed, matchesSelector, mergeSlides } from './indexer.js';
import { loadIndex } from './index-sync.js';
import { mutate } from './mutations.js';
import {
  initializeWorkspace,
  persistWrite,
  readHistory,
  readManifest,
  revision,
  sourceDir,
  undoWrites,
  withWriteLock,
} from './workspace.js';

const VERSION = '0.4.0';
const WRITE_TYPES = new Set([
  'setText',
  'replaceText',
  'setTransform',
  'setProperties',
  'add',
  'remove',
  'replacePicture',
  'duplicate',
  'batch',
]);

export const pptxCapabilities = {
  slides: { add: true, duplicate: true, remove: true },
  elements: ['shape', 'textbox', 'connector', 'group', 'picture', 'table', 'chart'],
  pictureInput: ['base64', 'path'],
  picture: { replacePicture: true, cleanupUnreferencedMedia: true },
  chart: { title: true, seriesCache: true, embeddedWorkbook: false },
  properties: {
    text: true,
    name: true,
    srgbClr: true,
    fill: true,
    stroke: true,
    textColor: true,
    fontFamily: true,
    fontSize: true,
    bold: true,
    italic: true,
    underline: true,
    hidden: true,
    aliases: {
      stroke: ['border', 'outline', 'line'],
      fontFamily: ['font', 'typeface'],
      fontSize: ['size'],
      textColor: ['fontColor'],
    },
  },
  query: { matchAll: ['*', 'all'], textRegex: true, hasText: true },
  text: { setText: true, replaceText: true },
  history: { undo: true },
  preservation: 'unknown parts and untouched XML are preserved; ZIP entries are recompressed',
} as const;

const openWorkspaceArchive = async (workspace: string): Promise<OpcArchive> =>
  OpcArchive.openDirectory(sourceDir(workspace));

const validateArchive = (archive: OpcArchive): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const [source, rels] of archive.relationships)
    for (const rel of rels)
      if (!rel.external && rel.resolvedTarget && !archive.getPart(rel.resolvedTarget))
        diagnostics.push({
          severity: 'error',
          code: 'BROKEN_RELATIONSHIP',
          message: `Missing target ${rel.resolvedTarget}`,
          details: { source, relationshipId: rel.id },
        });
  return diagnostics;
};

const slidesFromOutcome = (outcome: { slides?: number[] } | undefined): number[] =>
  outcome?.slides ?? [];

export const pptxAdapter: FormatAdapter = {
  format: 'pptx',
  version: VERSION,
  async init(command) {
    try {
      const workspace = resolve(command.workspaceId);
      const archive = await OpcArchive.openFile(resolve(command.source));
      if (!archive.getPart('/ppt/presentation.xml'))
        return err('VALIDATION_FAILED', 'Not a PPTX presentation');
      const created = new Date().toISOString(),
        rev = revision();
      const manifest: WorkspaceManifest = {
        schemaVersion: '1.0',
        workspaceId: workspace,
        format: 'pptx',
        source: resolve(command.source),
        revision: rev,
        createdAt: created,
        updatedAt: created,
        adapterVersion: VERSION,
        files: [],
        metadata: { capabilities: pptxCapabilities },
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
      return err('IO_ERROR', cause instanceof Error ? cause.message : 'PPTX init failed');
    }
  },
  async execute(command) {
    const workspace = resolve(command.workspaceId);
    try {
      if (command.type === 'undo') {
        return await withWriteLock(workspace, async () => {
          try {
            const result = await undoWrites(workspace, command.steps);
            return ok(result);
          } catch (cause) {
            return err('VALIDATION_FAILED', cause instanceof Error ? cause.message : 'Undo failed');
          }
        });
      }
      if (command.type === 'history') {
        const { records, total } = await readHistory(workspace, command.limit, command.offset);
        return ok({ records, total });
      }

      const manifest = await readManifest(workspace);
      const archive = await openWorkspaceArchive(workspace);
      const index = await loadIndex(workspace, archive, manifest, { persist: true });

      if (command.type === 'inspect') {
        if (command.ref) {
          const item = findIndexed(index, command.ref);
          return item ? ok(item) : err('ELEMENT_NOT_FOUND', 'Element reference was not found');
        }
        return ok({
          document: { format: 'pptx', revision: index.revision, capabilities: pptxCapabilities },
          elements: index.elements,
        });
      }
      if (command.type === 'query')
        return ok(
          index.elements
            .filter((item) => matchesSelector(item, command.selector))
            .slice(0, command.limit),
        );
      if (command.type === 'getText') {
        const item = findIndexed(index, command.ref);
        return item
          ? ok({
              ref: item.ref,
              slide: item.slideId,
              text: item.text ?? '',
              kind: item.kind,
              geometry: item.transform,
              location: item.location,
              payload: item.kind === 'chart' || item.kind === 'picture' ? item.payload : undefined,
            })
          : err('ELEMENT_NOT_FOUND', 'Element reference was not found');
      }
      if (command.type === 'validate') {
        const diagnostics = validateArchive(archive);
        return diagnostics.length
          ? err('VALIDATION_FAILED', 'PPTX validation failed', diagnostics)
          : ok({ valid: true, revision: index.revision, capabilities: pptxCapabilities });
      }

      if (!WRITE_TYPES.has(command.type))
        return err('INVALID_COMMAND', `Unsupported command type: ${command.type}`);

      if (command.transactionId !== manifest.revision && command.transactionId !== 'latest')
        return err('TRANSACTION_CONFLICT', `Expected transactionId ${manifest.revision}`);

      return await withWriteLock(workspace, async () => {
        const currentManifest = await readManifest(workspace);
        if (command.transactionId !== currentManifest.revision && command.transactionId !== 'latest')
          return err('TRANSACTION_CONFLICT', `Expected transactionId ${currentManifest.revision}`);

        const working = await openWorkspaceArchive(workspace);
        const currentIndex = await loadIndex(workspace, working, currentManifest);

        if (command.type === 'batch') {
          const results: unknown[] = [];
          const diagnostics: Diagnostic[] = [];
          const slidePages: number[] = [];
          for (const nested of command.commands) {
            const result = await mutate(nested, working, currentIndex);
            diagnostics.push(...result.diagnostics);
            if (!result.ok) return result;
            results.push(result.value);
            slidePages.push(...slidesFromOutcome(result.value));
          }
          const validation = validateArchive(working);
          if (validation.length)
            return err('VALIDATION_FAILED', 'PPTX validation failed', validation);
          if (command.dryRun)
            return ok({ results, revision: currentManifest.revision, dryRun: true }, diagnostics);
          const rev = revision();
          const nextIndex = buildIndex(working, currentManifest.workspaceId, rev);
          const saved = await persistWrite(
            workspace,
            working,
            currentManifest,
            nextIndex,
            command,
            mergeSlides(slidePages),
          );
          return ok({ results, revision: saved.revision }, diagnostics);
        }

        const result = await mutate(command, working, currentIndex);
        if (!result.ok) return result;
        const validation = validateArchive(working);
        if (validation.length) return err('VALIDATION_FAILED', 'PPTX validation failed', validation);
        if (command.dryRun)
          return ok(
            { ...result.value, revision: currentManifest.revision, dryRun: true },
            result.diagnostics,
          );
        const rev = revision();
        const nextIndex = buildIndex(working, currentManifest.workspaceId, rev);
        const saved = await persistWrite(
          workspace,
          working,
          currentManifest,
          nextIndex,
          command,
          slidesFromOutcome(result.value),
        );
        return ok({ ...result.value, revision: saved.revision }, result.diagnostics);
      });
    } catch (cause) {
      return err('IO_ERROR', cause instanceof Error ? cause.message : 'PPTX operation failed');
    }
  },
};
