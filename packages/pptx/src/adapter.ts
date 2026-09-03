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
  cNvPrIdOf,
  resolveTarget,
  targetPathForItem,
  uidForItem,
} from './addressing.js';
import { buildIndex, findIndexed, matchesSelector, mergeSlides } from './indexer.js';
import { loadIndex } from './index-sync.js';
import { mutate } from './mutations.js';
import { resolveProperties } from './resolve-properties.js';
import {
  initializeWorkspace,
  packagePath,
  persistWrite,
  readHistory,
  readManifest,
  revision,
  sourceDir,
  undoWrites,
  withWriteLock,
} from './workspace.js';

const VERSION = '0.5.0';
const WRITE_TYPES = new Set([
  'setText',
  'replaceText',
  'setTransform',
  'setProperties',
  'set',
  'xfrmSet',
  'zMove',
  'add',
  'addSlide',
  'addShape',
  'remove',
  'replacePicture',
  'duplicate',
  'batch',
  'applyTransaction',
]);

export const pptxCapabilities = {
  protocol: '2.0',
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
    dotted: [
      'font.family',
      'font.size',
      'font.weight',
      'font.italic',
      'font.underline',
      'font.color',
      'fill.color',
      'fill.kind',
      'line.color',
      'line.kind',
      'line.width',
      'text.value',
      'visible',
    ],
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
  addressing: { targetPath: true, uid: true },
  resolve: { effective: true, direct: true, both: true, provenance: true },
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

const listResource = (
  index: ReturnType<typeof buildIndex>,
  resource: 'slides' | 'shapes' | 'layouts' | 'masters' | 'theme',
  slide?: number,
) => {
  if (resource === 'slides') {
    return index.elements
      .filter((item) => item.kind === 'slide')
      .map((item, i) => ({
        target: `slide:${i + 1}`,
        uid: uidForItem(item),
        index: i + 1,
        slideId: item.slideId,
        name: item.name,
        titlePreview: item.text?.slice(0, 80),
        partUri: item.partUri,
      }));
  }
  if (resource === 'shapes') {
    if (slide === undefined)
      return err('INVALID_COMMAND', 'list shapes requires --slide', [], {
        hint: 'deckuse list shapes --slide <n> --json',
      });
    const slides = index.elements.filter((item) => item.kind === 'slide');
    const slideItem = slides[slide - 1];
    if (!slideItem)
      return err('TARGET_NOT_FOUND', `slide:${slide} does not exist`, [], {
        target: `slide:${slide}`,
      });
    return index.elements
      .filter(
        (item) =>
          item.partUri === slideItem.partUri &&
          !['slide', 'notes', 'master', 'layout', 'theme', 'tableCell'].includes(item.kind),
      )
      .map((item, z) => ({
        target: targetPathForItem(index, item),
        uid: uidForItem(item),
        id: cNvPrIdOf(item),
        name: item.name,
        kind: item.kind,
        role: item.payload?.['role'],
        bbox: item.transform,
        zOrder: z,
        textPreview: item.text?.slice(0, 80),
        parentId: item.parentId,
      }));
  }
  if (resource === 'layouts' || resource === 'masters') {
    const kind = resource === 'layouts' ? 'layout' : 'master';
    return index.elements
      .filter((item) => item.kind === kind)
      .map((item) => ({
        target: targetPathForItem(index, item),
        uid: uidForItem(item),
        name: item.partUri.split('/').pop()?.replace(/\.xml$/, ''),
        partUri: item.partUri,
      }));
  }
  return index.elements
    .filter((item) => item.kind === 'theme')
    .map((item) => ({
      target: 'theme',
      uid: uidForItem(item),
      partUri: item.partUri,
      colors: item.payload?.['colors'],
    }));
};

const transactionOpsToAtomic = (
  ops: Record<string, unknown>[],
  workspaceId: string,
  transactionId: string,
): Result<AtomicCommand[]> => {
  const commands: AtomicCommand[] = [];
  for (const op of ops) {
    const kind = String(op['op'] ?? op['type'] ?? '');
    const base = {
      version: '2.0' as const,
      workspaceId,
      transactionId,
    };
    if (kind === 'add-shape' || kind === 'addShape') {
      const shapeType = String(op['shapeType'] ?? op['type'] ?? 'text');
      const allowed = new Set([
        'text',
        'rect',
        'rounded-rect',
        'ellipse',
        'line',
        'image',
        'group',
      ]);
      if (!allowed.has(shapeType))
        return err('UNSUPPORTED_CAPABILITY', `Unsupported shape type: ${shapeType}`);
      commands.push({
        ...base,
        type: 'addShape',
        slide: Number(op['slide']),
        shapeType: shapeType as
          | 'text'
          | 'rect'
          | 'rounded-rect'
          | 'ellipse'
          | 'line'
          | 'image'
          | 'group',
        ...(typeof op['name'] === 'string' ? { name: op['name'] } : {}),
        ...(typeof op['role'] === 'string' ? { role: op['role'] } : {}),
        ...(typeof op['x'] === 'number' ? { x: op['x'] } : {}),
        ...(typeof op['y'] === 'number' ? { y: op['y'] } : {}),
        ...(typeof op['width'] === 'number' ? { width: op['width'] } : {}),
        ...(typeof op['height'] === 'number' ? { height: op['height'] } : {}),
        ...(typeof op['file'] === 'string' ? { file: op['file'] } : {}),
      });
      continue;
    }
    if (kind === 'set-text' || kind === 'setText') {
      commands.push({
        ...base,
        type: 'setText',
        target: String(op['target']),
        value: String(op['value'] ?? op['text'] ?? ''),
      });
      continue;
    }
    if (kind === 'set') {
      const { op: _op, type: _type, target, ...rest } = op;
      const properties = (op['properties'] as Record<string, unknown> | undefined) ?? rest;
      const cleaned = { ...properties };
      delete cleaned['target'];
      delete cleaned['op'];
      delete cleaned['type'];
      commands.push({
        ...base,
        type: 'set',
        target: String(target),
        properties: cleaned,
        scope: 'local',
      });
      continue;
    }
    if (kind === 'add-slide' || kind === 'addSlide') {
      commands.push({
        ...base,
        type: 'addSlide',
        ...(typeof op['after'] === 'number' ? { after: op['after'] } : {}),
        ...(typeof op['layout'] === 'string' ? { layout: op['layout'] } : {}),
        ...(typeof op['name'] === 'string' ? { name: op['name'] } : {}),
      });
      continue;
    }
    if (kind === 'remove') {
      commands.push({ ...base, type: 'remove', target: String(op['target']) });
      continue;
    }
    return err('UNSUPPORTED_CAPABILITY', `Unsupported transaction op: ${kind || '(missing)'}`);
  }
  return ok(commands);
};

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
        schemaVersion: '2.0',
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
        const filtered =
          command.slide !== undefined
            ? records.filter((record) => record.slides.includes(command.slide!))
            : records;
        return ok({ records: filtered, total: command.slide !== undefined ? filtered.length : total });
      }

      const manifest = await readManifest(workspace);
      if (manifest.schemaVersion !== '2.0' || !isIntegerRevision(manifest.revision)) {
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
          elementCount: index.elements.length,
          capabilities: pptxCapabilities,
          branch: 'main',
        });
      }

      if (command.type === 'list') {
        const listed = listResource(index, command.resource, command.slide);
        if (listed && typeof listed === 'object' && 'ok' in listed && listed.ok === false)
          return listed;
        return ok({ resource: command.resource, items: listed });
      }

      if (command.type === 'get') {
        const resolved = resolveTarget(index, command.target);
        if (!resolved.ok) return resolved;
        const details = resolveProperties(archive, resolved.value, {
          resolve: command.resolve,
          ...(command.props ? { props: command.props } : {}),
          provenance: command.provenance ?? true,
        });
        return ok(details);
      }

      if (command.type === 'search') {
        const items = index.elements.filter((item) => {
          if (command.kind === 'text') {
            if (!item.text) return false;
            if (command.query && !item.text.toLowerCase().includes(command.query.toLowerCase()))
              return false;
          } else {
            if (command.name && item.name !== command.name) return false;
            if (
              command.query &&
              !(item.name ?? '').toLowerCase().includes(command.query.toLowerCase())
            )
              return false;
          }
          return true;
        });
        if (command.kind === 'shape' && command.name) {
          const named = items.filter((item) => item.name === command.name);
          if (named.length > 1)
            return err('AMBIGUOUS_NAME', `Shape name is ambiguous: ${command.name}`);
        }
        return ok({
          matches: items.slice(0, command.limit).map((item) => ({
            target: targetPathForItem(index, item),
            uid: uidForItem(item),
            name: item.name,
            kind: item.kind,
            text: item.text?.slice(0, 200),
            context: item.partUri,
          })),
        });
      }

      if (command.type === 'inspect') {
        if (command.target) {
          const resolved = resolveTarget(index, command.target);
          if (!resolved.ok) return resolved;
          const details = resolveProperties(archive, resolved.value, {
            resolve: 'both',
            provenance: true,
          });
          return ok({
            target: resolved.value.target,
            uid: resolved.value.uid,
            kind: resolved.value.item.kind,
            name: resolved.value.item.name,
            partUri: resolved.value.item.partUri,
            transform: resolved.value.item.transform,
            visualTree: command.visualTree
              ? index.elements
                  .filter((item) => item.partUri === resolved.value.item.partUri)
                  .map((item) => ({
                    target: targetPathForItem(index, item),
                    kind: item.kind,
                    name: item.name,
                  }))
              : undefined,
            properties: details.properties,
            warnings: details.warnings,
          });
        }
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
              target: targetPathForItem(index, item),
              uid: uidForItem(item),
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
          : ok({
              valid: true,
              revision: index.revision,
              capabilities: pptxCapabilities,
            });
      }

      if (command.type === 'export') {
        if (command.revision !== undefined && String(command.revision) !== manifest.revision)
          return err(
            'UNSUPPORTED_CAPABILITY',
            'Export of historical revisions is not available in Phase 1a',
            [],
            { hint: 'Omit --revision to export the current workspace package.' },
          );
        const output = resolve(command.output);
        await copyFile(packagePath(workspace), output);
        return ok({
          output,
          revision: manifest.revision,
        });
      }

      if (!WRITE_TYPES.has(command.type))
        return err('INVALID_COMMAND', `Unsupported command type: ${command.type}`);

      const conflict = assertExpectRevision(command, manifest.revision);
      if (conflict) return conflict;

      return await withWriteLock(workspace, async () => {
        const currentManifest = await readManifest(workspace);
        const locked = assertExpectRevision(command, currentManifest.revision);
        if (locked) return locked;

        const working = await openWorkspaceArchive(workspace);
        const currentIndex = await loadIndex(workspace, working, currentManifest);

        const runBatch = async (
          nestedCommands: AtomicCommand[],
          dryRun: boolean | undefined,
          operation: unknown,
        ) => {
          const results: unknown[] = [];
          const diagnostics: Diagnostic[] = [];
          const slidePages: number[] = [];
          const changedTargets: string[] = [];
          const changedParts: string[] = [];
          for (const nested of nestedCommands) {
            const result = await mutate(nested, working, currentIndex);
            diagnostics.push(...result.diagnostics);
            if (!result.ok) return result;
            results.push(result.value);
            slidePages.push(...slidesFromOutcome(result.value));
            if (result.value.changedTargets) changedTargets.push(...result.value.changedTargets);
            if (result.value.changedParts) changedParts.push(...result.value.changedParts);
          }
          const validation = validateArchive(working);
          if (validation.length)
            return err('VALIDATION_FAILED', 'PPTX validation failed', validation);
          if (dryRun)
            return ok(
              {
                results,
                revision: currentManifest.revision,
                dryRun: true,
                changedTargets: [...new Set(changedTargets)],
                changedParts: [...new Set(changedParts)],
                affectedSlides: mergeSlides(slidePages),
              },
              diagnostics,
            );
          const rev = nextRevision(currentManifest.revision);
          const nextIndex = buildIndex(working, currentManifest.workspaceId, rev);
          const saved = await persistWrite(
            workspace,
            working,
            currentManifest,
            nextIndex,
            operation,
            mergeSlides(slidePages),
          );
          return ok(
            {
              results,
              revision: saved.revision,
              changedTargets: [...new Set(changedTargets)],
              changedParts: [...new Set(changedParts)],
              affectedSlides: mergeSlides(slidePages),
            },
            diagnostics,
          );
        };

        if (command.type === 'applyTransaction') {
          const mapped = transactionOpsToAtomic(
            command.operations,
            command.workspaceId,
            command.transactionId,
          );
          if (!mapped.ok) return mapped;
          return runBatch(mapped.value, command.dryRun, command);
        }

        if (command.type === 'batch') {
          return runBatch(command.commands, command.dryRun, command);
        }

        const result = await mutate(command as AtomicCommand, working, currentIndex);
        if (!result.ok) return result;
        const validation = validateArchive(working);
        if (validation.length) return err('VALIDATION_FAILED', 'PPTX validation failed', validation);
        if (command.dryRun)
          return ok(
            {
              ...result.value,
              revision: currentManifest.revision,
              dryRun: true,
              affectedSlides: slidesFromOutcome(result.value),
            },
            result.diagnostics,
          );
        const rev = nextRevision(currentManifest.revision);
        const nextIndex = buildIndex(working, currentManifest.workspaceId, rev);
        const saved = await persistWrite(
          workspace,
          working,
          currentManifest,
          nextIndex,
          command,
          slidesFromOutcome(result.value),
        );
        return ok(
          {
            ...result.value,
            revision: saved.revision,
            affectedSlides: slidesFromOutcome(result.value),
          },
          result.diagnostics,
        );
      });
    } catch (cause) {
      return err('IO_ERROR', cause instanceof Error ? cause.message : 'PPTX operation failed');
    }
  },
};
