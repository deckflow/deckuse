import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  err,
  ok,
  type Diagnostic,
  type FormatAdapter,
  type WorkspaceManifest,
} from '@deckflow/deckuse-core';
import { OpcArchive } from '@deckflow/deckuse-opc';
import { buildIndex, findIndexed, matchesSelector } from './indexer.js';
import { mutate } from './mutations.js';
import {
  deckuseDir,
  packagePath,
  persist,
  readIndex,
  readManifest,
  revision,
} from './workspace.js';
const VERSION = '0.3.0';
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
  commit: { overwrite: true },
  preservation: 'unknown parts and untouched XML are preserved; ZIP entries are recompressed',
} as const;
export const pptxAdapter: FormatAdapter = {
  format: 'pptx',
  version: VERSION,
  async init(command) {
    try {
      const workspace = resolve(command.workspaceId);
      await mkdir(deckuseDir(workspace), { recursive: true });
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
      const saved = await persist(
        workspace,
        archive,
        manifest,
        buildIndex(archive, workspace, rev),
        { type: 'init', source: command.source },
      );
      return ok(saved);
    } catch (cause) {
      return err('IO_ERROR', cause instanceof Error ? cause.message : 'PPTX init failed');
    }
  },
  async execute(command) {
    const workspace = resolve(command.workspaceId);
    try {
      const manifest = await readManifest(workspace),
        archive = await OpcArchive.openFile(packagePath(workspace));
      let index;
      try {
        index = await readIndex(workspace);
      } catch {
        index = buildIndex(archive, manifest.workspaceId, manifest.revision);
      }
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
        return diagnostics.length
          ? err('VALIDATION_FAILED', 'PPTX validation failed', diagnostics)
          : ok({ valid: true, revision: index.revision, capabilities: pptxCapabilities });
      }
      if (command.type === 'commit') {
        if (command.transactionId !== manifest.revision && command.transactionId !== 'latest')
          return err('TRANSACTION_CONFLICT', `Expected transactionId ${manifest.revision}`);
        const destination = resolve(
          command.destination ??
            join(dirname(manifest.source), `${basename(manifest.source, '.pptx')}.deckuse.pptx`),
        );
        if (!command.overwrite) {
          try {
            await readFile(destination);
            return err('IO_ERROR', `Destination exists: ${destination}`);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        await mkdir(dirname(destination), { recursive: true });
        const temp = `${destination}.${randomUUID()}.tmp`;
        await copyFile(packagePath(workspace), temp);
        await OpcArchive.openFile(temp);
        await rename(temp, destination);
        return ok({ destination, revision: manifest.revision });
      }
      if (command.transactionId !== manifest.revision && command.transactionId !== 'latest')
        return err('TRANSACTION_CONFLICT', `Expected transactionId ${manifest.revision}`);
      if (command.type === 'batch') {
        const working = await OpcArchive.open(await archive.toUint8Array()),
          results: unknown[] = [],
          diagnostics: Diagnostic[] = [];
        for (const nested of command.commands) {
          const result = await mutate(nested, working, index);
          diagnostics.push(...result.diagnostics);
          if (!result.ok) {
            if (!command.atomic && results.length) {
              const rev = revision();
              await persist(
                workspace,
                working,
                manifest,
                buildIndex(working, manifest.workspaceId, rev),
                { ...command, partial: true, failed: nested.type },
              );
              return err('VALIDATION_FAILED', 'Non-atomic batch partially applied', [
                ...diagnostics,
                {
                  severity: 'warning',
                  code: 'PARTIAL_BATCH_APPLIED',
                  message: `${String(results.length)} operation(s) were committed before failure`,
                },
              ]);
            }
            return result;
          }
          results.push(result.value);
        }
        if (command.dryRun)
          return ok({ results, revision: manifest.revision, dryRun: true }, diagnostics);
        const rev = revision(),
          saved = await persist(
            workspace,
            working,
            manifest,
            buildIndex(working, manifest.workspaceId, rev),
            command,
          );
        return ok({ results, revision: saved.revision }, diagnostics);
      }
      const working = await OpcArchive.open(await archive.toUint8Array()),
        result = await mutate(command, working, index);
      if (!result.ok) return result;
      if (command.dryRun)
        return ok(
          { ...result.value, revision: manifest.revision, dryRun: true },
          result.diagnostics,
        );
      const rev = revision(),
        saved = await persist(
          workspace,
          working,
          manifest,
          buildIndex(working, manifest.workspaceId, rev),
          command,
        );
      return ok({ ...result.value, revision: saved.revision }, result.diagnostics);
    } catch (cause) {
      return err('IO_ERROR', cause instanceof Error ? cause.message : 'PPTX operation failed');
    }
  },
};
