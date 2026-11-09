import fs from 'node:fs';
import { resolveRef } from 'isomorphic-git';
import { managedRetirement, retireOwnedPath } from '../workspace/cleanup.js';
import {
  operationDigest,
  readApplyReceipt,
  writeApplyReceipt,
  type ApplyReceipt,
} from '../workspace/receipts.js';
import { exportDigest } from './export-recovery.js';
import { tableMergeDiagnostics } from './table.js';
import { assertChartProperties } from './properties.js';
import { assertDefaultPptxExists } from '../default-template.js';
import { describeSlideSize, setBlankPageSize } from './slide-size.js';
import { validateReviewParts } from '../review/validation.js';
import { REVIEW_WRITES, reviewWriteSchema } from '../review/schema.js';
import { slideComments, mutateSlideComments } from './comments.js';
import { requireDefined } from '../required.js';
import { timed, timedSync } from '../timing.js';
import {
  recoverTransaction,
  RecoveryRequiredError,
  historyHealth,
} from '../workspace/transaction.js';
import { initializationState, WorkspaceNotEmptyError } from '../workspace/initialize.js';
import { auditVisuals } from './visual-audit.js';
import { ChartDataError, verifyChartData, prepareChartData } from './chart-data.js';
import { randomUUID } from 'node:crypto';
import { access, copyFile, readFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  err,
  ok,
  type AtomicCommand,
  type Diagnostic,
  type FormatAdapter,
  type Result,
  type WorkspaceManifest,
} from '../core/index.js';
import { OpcArchive } from '../opc/index.js';
import { isIntegerRevision, nextRevision } from '../workspace/index.js';
import { rankFind } from '../find/rank.js';
import { cNvPrIdOf, resolveTarget, targetPathForItem, uidForItem } from './addressing.js';
import { collectPptxFindCandidates } from './find-candidates.js';
import { editionCapabilities, editionMetadata } from './edition.js';
import { buildIndex as buildIndexImpl, findIndexed, pptxSelector, mergeSlides } from './indexer.js';
import { loadIndex } from './index-sync.js';
import {
  layoutDisplayName,
  layoutListMeta,
  orderedLayouts,
  slideLayoutPart,
} from './layout-ref.js';
import { mutate } from './mutations.js';
import { resolveProperties } from './resolve-properties.js';
import {
  applyNotesSlideRepairs,
  planNotesSlideRepairs,
  repairNotesHint,
  syncAppSlideCounts,
} from './slides.js';
import {
  initializeWorkspace,
  hashSourceTree,
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
import { NS, REL, descendants } from './xml.js';

const buildIndex: typeof buildIndexImpl = (...args) =>
  timedSync('index', () => buildIndexImpl(...args));

const VERSION = '0.5.0';
const WRITE_TYPES = new Set([
  ...REVIEW_WRITES,
  'setText',
  'replaceText',
  'setTransform',
  'setProperties',
  'set',
  'xfrmSet',
  'setTableLayout',
  'groupShapes',
  'ungroupShapes',
  'mergeTableCells',
  'unmergeTableCells',
  'zMove',
  'alignElements',
  'add',
  'addSlide',
  'setSlideLayout',
  'addShape',
  'remove',
  'replacePicture',
  'duplicate',
  'batch',
  'applyTransaction',
]);

export const pptxCapabilities = {
  comments: {
    formats: ['legacy', 'modern'],
    read: true,
    write: true,
    modernThreads: true,
    upgrade: 'explicit',
    anchors: ['slide', 'shape', 'text'],
  },
  protocol: '2.0',
  ...editionMetadata,
  slides: { add: true, duplicate: true, remove: true, setLayout: true },
  // Master/layout/theme: list always. `edit` flags are status metadata only —
  // writes require a registered PptxEditionExtension (never opened by flags alone).
  masters: { list: true, edit: editionCapabilities.mastersEdit },
  layouts: { list: true, edit: editionCapabilities.layoutsEdit },
  theme: { list: true, edit: editionCapabilities.themeEdit },
  elements: [
    'shape',
    'textbox',
    'connector',
    'group',
    'picture',
    'video',
    'audio',
    'table',
    'chart',
  ],
  groups: { group: true, ungroup: true, preserveZOrder: true, rejectShear: true },
  connectors: {
    bindEndpoints: true,
    routing: ['auto', 'preserve'],
    nodeDeletion: ['detach', 'reject'],
  },
  fills: { linearGradient: true, pathGradient: false },
  pictureInput: ['base64', 'path'],
  picture: { replacePicture: true, cleanupUnreferencedMedia: true },
  media: { video: true, audio: true, autoPoster: true },
  chart: {
    create: true,
    families: ['bar', 'column', 'line', 'pie', 'combo'],
    basicOnly: editionCapabilities.chartBasicOnly,
    title: true,
    seriesCache: true,
    seriesColor: true,
    textColor: true,
    gapWidth: true,
    showMajorGridlines: true,
    showDataLabels: true,
    valueFormatCode: true,
    comboDualAxis: true,
    fill: true,
    embeddedWorkbook: true,
    createEmbeddedWorkbook: true,
    updateEmbeddedWorkbook: {
      supported: true,
      fixedLengthA1: true,
      constantCellsOnly: true,
      sharedWorkbookIsolation: true,
      formulas: false,
      dependencyPreflight: true,
      independentFormulaPreservation: true,
      resizeRanges: false,
    },
    grouping: ['clustered'],
    secondaryAxis: 'combo',
    rendering: { html: 'approximate', nativeOfficeReviewRequired: true },
    createFamilies: ['bar', 'column', 'line', 'pie', 'combo'],
    editExistingAdvanced: !editionCapabilities.chartBasicOnly,
  },
  table: {
    rowHeights: true,
    mergeRegion: true,
    unmergeRegion: true,
    insertRow: true,
    deleteRow: true,
    insertColumn: true,
    deleteColumn: true,
    cellFill: true,
    cellFont: true,
    cellBorder: true,
    cellPadding: true,
    heightAuto: true,
    themes: ['minimal', 'zebra'],
    alignColumns: true,
  },
  placeholder: { index: true, address: true, roleOnAdd: true },
  hyperlink: { set: true, clear: true },
  notes: { ensureOnWrite: true },
  properties: {
    text: true,
    name: true,
    srgbClr: true,
    fill: true,
    fillTransparency: true,
    stroke: true,
    textColor: true,
    fontFamily: true,
    fontSize: true,
    bold: true,
    italic: true,
    underline: true,
    hidden: true,
    paragraphAlign: true,
    paragraphLevel: true,
    bullet: true,
    hyperlink: true,
    dotted: [
      'font.family',
      'font.size',
      'font.weight',
      'font.italic',
      'font.underline',
      'font.color',
      'fill.color',
      'fill.kind',
      'fill.transparency',
      'line.color',
      'line.kind',
      'line.width',
      'text.value',
      'visible',
      'paragraph.align',
      'paragraph.level',
      'bullet',
      'hyperlink',
    ],
    aliases: {
      stroke: ['border', 'outline', 'line'],
      fontFamily: ['font', 'typeface'],
      fontSize: ['size'],
      textColor: ['fontColor'],
    },
  },
  query: { matchAll: ['*', 'all'], textRegex: true, hasText: true },
  text: {
    setText: true,
    replaceText: true,
    multiParagraph: true,
    richRuns: true,
    paragraphBlocks: true,
  },
  geometry: {
    customPath: true,
    commands: ['move', 'line', 'cubic', 'close'],
    units: ['emu', 'px', 'pt', 'cm', 'mm', 'in', '%'],
    alignElements: true,
    cornerRadius: true,
  },
  textBox: { wrap: true, anchor: true },
  measure: { heuristic: true },
  shapes: {
    lineIsStraightConnector: true,
    elbowConnector: true,
    curvedConnector: true,
    arrows: ['rightArrow', 'leftArrow', 'upArrow', 'downArrow'],
    flow: [
      'chevron',
      'homePlate',
      'trapezoid',
      'triangle',
      'rtTriangle',
      'circularArrow',
      'curvedRightArrow',
      'curvedLeftArrow',
    ],
  },
  history: { undo: true },
  addressing: { targetPath: true, uid: true, placeholder: true, notes: true, runFocus: true },
  resolve: { effective: true, direct: true, both: true, provenance: true },
  preservation: 'unknown parts and untouched XML are preserved; ZIP entries are recompressed',
  propertyVocabulary: {
    note: 'Prefer deckuse schema --json for full command schemas. Capabilities flags are coarse.',
    paragraphAlign: {
      key: 'paragraph.align',
      values: ['l', 'ctr', 'r', 'just'],
      aliases: { left: 'l', center: 'ctr', right: 'r', justify: 'just' },
    },
    richText: {
      blocks: 'one paragraph per block; optional runs[] for intra-paragraph styling',
      runTarget: 'slide:N/shape:X/run:K for setProperties on a single run',
    },
  },
} as const;

const openWorkspaceArchive = async (workspace: string): Promise<OpcArchive> =>
  OpcArchive.openDirectory(sourceDir(workspace));

async function noOpBase(workspace: string) {
  const commit = await resolveRef({ fs, dir: workspace, ref: 'HEAD' });
  return { commit, contentHash: await hashSourceTree(workspace) };
}

async function isNoOpCurrent(workspace: string, revision: string, receipt: ApplyReceipt) {
  if (!receipt.noOpBase || revision !== receipt.revision) return false;
  const current = await noOpBase(workspace);
  return (
    current.commit === receipt.noOpBase.commit &&
    current.contentHash === receipt.noOpBase.contentHash
  );
}

function partChanges(archive: OpcArchive) {
  const original = new Map(archive.parts);
  const types = () =>
    JSON.stringify([
      [...archive.contentTypes.defaults].sort(),
      [...archive.contentTypes.overrides].sort(),
    ]);
  const originalTypes = types();
  return () => {
    const names = new Set([...original.keys(), ...archive.parts.keys()]);
    const changed = [...names].filter((name) => {
      const before = original.get(name);
      const after = archive.parts.get(name);
      if (before === after) return false;
      if (!before || !after) return true;
      return (
        before.mediaType !== after.mediaType ||
        !Buffer.from(before.data.buffer, before.data.byteOffset, before.data.byteLength).equals(
          after.data,
        )
      );
    });
    if (types() !== originalTypes) changed.push('/[Content_Types].xml');
    return [...new Set(changed)].sort();
  };
}

function noOpReason(diagnostics: Diagnostic[], results: unknown[]) {
  if (diagnostics.some((item) => item.code === 'NO_TEXT_MATCH')) return 'no-text-match';
  if (
    results.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        'matchedTargets' in item &&
        item.matchedTargets &&
        'matched' in item &&
        item.matched === 0,
    )
  )
    return 'identical-replacement';
  return 'unchanged-content';
}

const chartDataDiagnostics = (
  items: Awaited<ReturnType<typeof verifyChartData>>,
  strict: boolean,
): Diagnostic[] =>
  items
    .filter((item) => item.status === 'unverified' || item.status === 'inconsistent')
    .map((item) => ({
      severity: strict ? 'error' : 'warning',
      code: item.status === 'inconsistent' ? 'CHART_DATA_INCONSISTENT' : 'CHART_DATA_UNVERIFIED',
      message: item.reason ?? `Chart data is ${item.status}`,
      details: { ...item },
    }));

const validateArchiveImpl = (archive: OpcArchive, workspace?: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = validateReviewParts(archive, 'pptx');
  for (const part of archive.parts.keys())
    if (/^\/ppt\/slides\/[^/]+\.xml$/.test(part))
      diagnostics.push(
        ...tableMergeDiagnostics(archive.readXml(part)).map((d) => ({
          ...d,
          details: { ...d.details, partUri: part },
        })),
      );
  for (const [source, rels] of archive.relationships)
    for (const rel of rels)
      if (!rel.external && rel.resolvedTarget && !archive.getPart(rel.resolvedTarget))
        diagnostics.push({
          severity: 'error',
          code: 'BROKEN_RELATIONSHIP',
          message: `Missing target ${rel.resolvedTarget}`,
          details: { source, relationshipId: rel.id },
        });

  // ZIP entries that differ only by case collide on macOS/Windows extract.
  const seenNames = new Map<string, string>();
  for (const name of archive.parts.keys()) {
    const key = name.toLowerCase();
    const previous = seenNames.get(key);
    if (previous) {
      diagnostics.push({
        severity: 'error',
        code: 'CASE_COLLIDING_PARTS',
        message: `Parts ${previous} and ${name} differ only by case (PowerPoint will prompt to repair on case-insensitive systems)`,
        details: { parts: [previous, name] },
      });
    } else {
      seenNames.set(key, name);
    }
  }

  // app.xml <Slides> must match p:sldIdLst only — not p14:sectionLst/p14:sldId.
  const appPart = archive.getPart('/docProps/app.xml');
  if (appPart && archive.getPart('/ppt/presentation.xml')) {
    const presentation = archive.readXml('/ppt/presentation.xml');
    const list = descendants(presentation, 'sldIdLst').find((el) => el.namespaceURI === NS.p);
    const slideCount = list
      ? descendants(list, 'sldId').filter((el) => el.namespaceURI === NS.p).length
      : 0;
    const app = archive.readXml('/docProps/app.xml');
    const slidesEl = descendants(app, 'Slides').find(
      (node) =>
        !node.namespaceURI ||
        node.namespaceURI ===
          'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
    );
    const declared = slidesEl?.textContent?.trim();
    if (declared !== undefined && declared !== '' && Number(declared) !== slideCount) {
      diagnostics.push({
        severity: 'error',
        code: 'SLIDE_COUNT_MISMATCH',
        message: `docProps/app.xml <Slides> is ${declared} but presentation has ${String(slideCount)} p:sldId entries (PowerPoint will prompt to repair)`,
        details: { declared: Number(declared), actual: slideCount },
      });
    }
  }

  // notesSlide ↔ slide relationships must point at each other.
  for (const [source, rels] of archive.relationships) {
    if (!source.startsWith('/ppt/slides/slide') || source.includes('/_rels/')) continue;
    for (const rel of rels) {
      if (rel.type !== REL.notes || !rel.resolvedTarget) continue;
      const notesRels = archive.getRelationships(rel.resolvedTarget);
      const back = notesRels.find((r) => r.type === REL.slide);
      if (!back?.resolvedTarget) {
        diagnostics.push({
          severity: 'error',
          code: 'NOTES_SLIDE_MISMATCH',
          message: `Notes part ${rel.resolvedTarget} has no slide relationship back to ${source}`,
          details: {
            slide: source,
            notes: rel.resolvedTarget,
            hint: repairNotesHint(workspace ?? '.'),
          },
        });
      } else if (back.resolvedTarget !== source) {
        diagnostics.push({
          severity: 'error',
          code: 'NOTES_SLIDE_MISMATCH',
          message: `Notes part ${rel.resolvedTarget} points at ${back.resolvedTarget} instead of owning slide ${source}`,
          details: {
            slide: source,
            notes: rel.resolvedTarget,
            notesPointsTo: back.resolvedTarget,
            hint: repairNotesHint(workspace ?? '.'),
          },
        });
      }
    }
  }

  return diagnostics;
};

const validateArchive: typeof validateArchiveImpl = (...args) =>
  timedSync('structural-validation', () => validateArchiveImpl(...args));

const notesRepairHintExtra = (
  workspace: string,
  diagnostics: readonly Diagnostic[],
): { hint: string } | Record<string, never> =>
  diagnostics.some((item) => item.code === 'NOTES_SLIDE_MISMATCH')
    ? { hint: repairNotesHint(workspace) }
    : {};

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

const listShapeItems = (index: ReturnType<typeof buildIndex>, partUri: string) =>
  index.elements
    .filter(
      (item) =>
        item.partUri === partUri &&
        !['slide', 'notes', 'master', 'layout', 'theme', 'tableCell'].includes(item.kind),
    )
    .map((item, z) => ({
      target: targetPathForItem(index, item),
      uid: uidForItem(item),
      id: cNvPrIdOf(item),
      name: item.name,
      kind: item.kind,
      role: item.payload?.['placeholder'] ?? item.payload?.['role'],
      bbox: item.transform,
      zOrder: z,
      textPreview: item.text?.slice(0, 80),
      parentId: item.parentId,
      ...(item.kind === 'chart'
        ? {
            chartVariant:
              item.payload?.['chartVariant'] === 'basic' ||
              item.payload?.['chartVariant'] === 'advanced'
                ? item.payload['chartVariant']
                : 'advanced',
          }
        : {}),
    }));

const listResource = (
  archive: OpcArchive,
  index: ReturnType<typeof buildIndex>,
  resource:
    | 'slides'
    | 'shapes'
    | 'layouts'
    | 'masters'
    | 'theme'
    | 'paragraphs'
    | 'tables'
    | 'sections'
    | 'styles'
    | 'bookmarks',
  options: { slide?: number; master?: string; layout?: string } = {},
) => {
  if (
    resource === 'paragraphs' ||
    resource === 'tables' ||
    resource === 'sections' ||
    resource === 'styles' ||
    resource === 'bookmarks'
  ) {
    return err(
      'UNSUPPORTED_CAPABILITY',
      `list ${resource} is a Word resource and is not available for PPTX`,
      [],
      { hint: 'Use slides, shapes, layouts, masters, or theme.' },
    );
  }
  if (resource === 'slides') {
    const layouts = orderedLayouts(index);
    const layoutIndexByPart = new Map(layouts.map((item, i) => [item.partUri, i + 1] as const));
    return index.elements
      .filter((item) => item.kind === 'slide')
      .map((item, i) => {
        const layoutPart = slideLayoutPart(archive, item.partUri);
        const layout =
          layoutPart !== undefined
            ? {
                target: `layout:${
                  layoutPart
                    .split('/')
                    .pop()
                    ?.replace(/\.xml$/i, '') ?? layoutPart
                }`,
                displayName: layoutDisplayName(archive, layoutPart),
                ...(layoutIndexByPart.has(layoutPart)
                  ? { index: requireDefined(layoutIndexByPart.get(layoutPart)) }
                  : {}),
              }
            : undefined;
        return {
          target: `slide:${String(i + 1)}`,
          uid: uidForItem(item),
          index: i + 1,
          slideId: item.slideId,
          name: item.name,
          titlePreview: item.text?.slice(0, 80),
          partUri: item.partUri,
          ...(layout !== undefined ? { layout } : {}),
        };
      });
  }
  if (resource === 'shapes') {
    const slide = options.slide;
    const master = options.master;
    const layout = options.layout;
    const specified = [slide !== undefined, Boolean(master), Boolean(layout)].filter(
      Boolean,
    ).length;
    if (specified !== 1)
      return err(
        'INVALID_COMMAND',
        'list shapes requires exactly one of --slide, --master, or --layout',
        [],
        { hint: 'deckuse list shapes --slide <n> | --master <name> | --layout <name> --json' },
      );
    if (slide !== undefined) {
      const slides = index.elements.filter((item) => item.kind === 'slide');
      const slideItem = slides[slide - 1];
      if (!slideItem)
        return err('TARGET_NOT_FOUND', `slide:${String(slide)} does not exist`, [], {
          target: `slide:${String(slide)}`,
        });
      return listShapeItems(index, slideItem.partUri);
    }
    if (master) {
      const resolved = resolveTarget(index, `master:${master}`);
      if (!resolved.ok) return resolved;
      return listShapeItems(index, resolved.value.item.partUri);
    }
    const resolved = resolveTarget(index, `layout:${requireDefined(layout)}`);
    if (!resolved.ok) return resolved;
    return listShapeItems(index, resolved.value.item.partUri);
  }
  if (resource === 'layouts' || resource === 'masters') {
    if (resource === 'layouts') {
      return orderedLayouts(index).map((item, i) => ({
        ...layoutListMeta(archive, item, i + 1),
        uid: uidForItem(item),
      }));
    }
    const kind = 'master';
    return index.elements
      .filter((item) => item.kind === kind)
      .map((item) => ({
        target: targetPathForItem(index, item),
        uid: uidForItem(item),
        name: item.partUri
          .split('/')
          .pop()
          ?.replace(/\.xml$/, ''),
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
    const kind =
      typeof op['op'] === 'string' ? op['op'] : typeof op['type'] === 'string' ? op['type'] : '';
    const base = {
      version: '2.0' as const,
      workspaceId,
      transactionId,
    };
    if (kind === 'add-shape' || kind === 'addShape') {
      const shapeType =
        typeof op['shapeType'] === 'string'
          ? op['shapeType']
          : typeof op['type'] === 'string'
            ? op['type']
            : 'text';
      const allowed = new Set([
        'text',
        'rect',
        'rounded-rect',
        'ellipse',
        'line',
        'connector',
        'elbow',
        'elbow-connector',
        'curved-connector',
        'arrow',
        'right-arrow',
        'left-arrow',
        'up-arrow',
        'down-arrow',
        'chevron',
        'pentagon',
        'trapezoid',
        'triangle',
        'rt-triangle',
        'circular-arrow',
        'curved-right-arrow',
        'curved-left-arrow',
        'image',
        'group',
        'table',
        'chart',
        'video',
        'audio',
      ]);
      if (!allowed.has(shapeType))
        return err('UNSUPPORTED_CAPABILITY', `Unsupported shape type: ${shapeType}`);
      commands.push({
        ...base,
        type: 'addShape',
        slide: Number(op['slide']),
        shapeType: shapeType as Extract<AtomicCommand, { type: 'addShape' }>['shapeType'],
        ...(typeof op['name'] === 'string' ? { name: op['name'] } : {}),
        ...(typeof op['role'] === 'string' ? { role: op['role'] } : {}),
        ...(typeof op['x'] === 'number' ? { x: op['x'] } : {}),
        ...(typeof op['y'] === 'number' ? { y: op['y'] } : {}),
        ...(typeof op['width'] === 'number' ? { width: op['width'] } : {}),
        ...(typeof op['height'] === 'number' ? { height: op['height'] } : {}),
        ...(typeof op['file'] === 'string' ? { file: op['file'] } : {}),
        ...(typeof op['text'] === 'string' ? { text: op['text'] } : {}),
        ...(Array.isArray(op['rows']) ? { rows: op['rows'] as string[][] } : {}),
        ...(typeof op['chartType'] === 'string'
          ? { chartType: op['chartType'] as 'bar' | 'column' | 'line' | 'pie' | 'combo' }
          : {}),
        ...(op['data'] !== undefined && typeof op['data'] === 'object' && op['data'] !== null
          ? {
              data: op['data'] as {
                title?: string;
                categories: string[];
                series: { name: string; values: number[] }[];
              },
            }
          : {}),
      });
      continue;
    }
    if (kind === 'set-text' || kind === 'setText') {
      commands.push({
        ...base,
        type: 'setText',
        target: String(op['target']),
        value:
          typeof op['value'] === 'string'
            ? op['value']
            : typeof op['text'] === 'string'
              ? op['text']
              : '',
      });
      continue;
    }
    if (kind === 'set') {
      const { target, ...rest } = op;
      delete rest['op'];
      delete rest['type'];
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
      // Real-world decks (templates, iSlide, etc.) often ship stale app.xml <Slides>.
      // Normalize on import so validate / first writes are not blocked by pre-existing drift.
      if (command.pageSize) {
        try {
          if (
            ![await assertDefaultPptxExists(), await assertDefaultPptxExists(true)].includes(
              resolve(command.source),
            )
          )
            return err(
              'INVALID_COMMAND',
              'pageSize is only supported with the bundled blank template',
            );
          setBlankPageSize(archive, command.pageSize);
        } catch (cause) {
          return err('INVALID_COMMAND', cause instanceof Error ? cause.message : String(cause));
        }
      }
      syncAppSlideCounts(archive);
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
      const cleanupWarnings: Diagnostic[] = [];
      const saved = await initializeWorkspace(
        workspace,
        archive,
        manifest,
        index,
        (path, cause) => {
          cleanupWarnings.push({
            severity: 'warning',
            code: 'INIT_CLEANUP_FAILED',
            message: String(cause),
            details: { path },
          });
        },
      );
      return ok(
        {
          workspaceId: saved.workspaceId,
          format: saved.format,
          source: saved.source,
          revision: saved.revision,
          pageSize: describeSlideSize(archive),
          elementCount: index.elements.length,
          ...(cleanupWarnings.length ? { diagnostics: cleanupWarnings } : {}),
          initializationState: cleanupWarnings.length
            ? 'committed-with-cleanup-warning'
            : 'committed',
        },
        cleanupWarnings,
      );
    } catch (cause) {
      return err(
        cause instanceof WorkspaceNotEmptyError ? 'WORKSPACE_NOT_EMPTY' : 'IO_ERROR',
        cause instanceof Error ? cause.message : 'PPTX init failed',
      );
    }
  },
  async execute(command, context = {}) {
    const workspace = resolve(command.workspaceId);
    try {
      const initialization = await initializationState(workspace);
      if (initialization?.state === 'initialization-incomplete') {
        return err('RECOVERY_REQUIRED', 'Workspace initialization is incomplete or locked.', [], {
          details: initialization,
          hint: 'Allow an active initializer to finish. If it has exited, preserve this directory and initialize a fresh workspace from the original input.',
        });
      }
      await access(resolve(workspace, '.deckuse'));
    } catch (cause) {
      return err(
        (cause as NodeJS.ErrnoException).code === 'ENOENT' ? 'WORKSPACE_NOT_FOUND' : 'IO_ERROR',
        cause instanceof Error ? cause.message : 'Workspace unavailable',
      );
    }
    return withWriteLock(workspace, async () => {
      try {
        await recoverTransaction(workspace, {
          allowCommittedCleanupFailure: command.type === 'status' && Boolean(command.requestId),
        });
        if (command.type === 'undo') {
          return await withWriteLock(workspace, async () => {
            try {
              const result = await undoWrites(workspace, command.steps);
              return ok(result);
            } catch (cause) {
              return err(
                cause instanceof RecoveryRequiredError ? 'RECOVERY_REQUIRED' : 'VALIDATION_FAILED',
                cause instanceof Error ? cause.message : 'Undo failed',
              );
            }
          });
        }
        if (command.type === 'status' && command.requestId) {
          const found = await readApplyReceipt(workspace, command.requestId);
          if (!found) return ok({ requestId: command.requestId, state: 'unknown' });
          const { requestId, operationSha256, previousRevision, revision, result } = found.receipt;
          const affectedSlides = Array.isArray(result['affectedSlides'])
            ? result['affectedSlides']
            : [];
          return ok({
            requestId,
            operationSha256,
            previousRevision,
            revision,
            state: found.receipt.noOpBase
              ? 'no-op'
              : found.receipt.rejection
                ? 'not-committed'
                : found.active
                  ? 'committed'
                  : 'reverted',
            ...(found.receipt.rejection ? { rejection: found.receipt.rejection } : {}),
            current: found.receipt.noOpBase
              ? await isNoOpCurrent(
                  workspace,
                  (await readManifest(workspace)).revision,
                  found.receipt,
                )
              : found.current && !(await isPackageStale(workspace)),
            operationCount: Array.isArray(result['results']) ? result['results'].length : 0,
            affectedSlides: affectedSlides.slice(0, 256),
            affectedSlideCount: affectedSlides.length,
          });
        }
        if (command.type === 'history') {
          const { records, total } = await readHistory(workspace, command.limit, command.offset);
          const filtered =
            command.slide !== undefined
              ? records.filter((record) => record.slides.includes(requireDefined(command.slide)))
              : records;
          return ok({
            records: filtered,
            total: command.slide !== undefined ? filtered.length : total,
          });
        }

        if (command.type === 'preflightChartData') {
          const archive = await openWorkspaceArchive(workspace),
            manifest = await readManifest(workspace);
          const index = await loadIndex(workspace, archive, manifest),
            resolved = resolveTarget(index, command.target);
          if (!resolved.ok) return resolved;
          const part = resolved.value.item.payload?.['chartPart'];
          if (typeof part !== 'string') return err('INVALID_COMMAND', 'Target must be a chart');
          try {
            const checked = assertChartProperties(command.properties);
            if (!checked.ok) return checked;
            const data = await prepareChartData(
              archive,
              part,
              archive.readXml(part),
              command.properties,
            );
            const refCount = (target: string) =>
              [...archive.relationships.values()]
                .flat()
                .filter((r) => !r.external && r.resolvedTarget === target).length;
            return ok({
              supported: true,
              revision: manifest.revision,
              changes: data?.changes ?? [],
              requiresIsolation: refCount(part) > 1 || (data ? refCount(data.embedded) > 1 : false),
            });
          } catch (cause) {
            return ok({
              supported: false,
              revision: manifest.revision,
              blockers: [
                {
                  code:
                    cause instanceof ChartDataError
                      ? String(cause.details['reasonCode'])
                      : 'CHART_DATA_UNSAFE',
                  ...(cause instanceof ChartDataError ? { details: cause.details } : {}),
                  target: command.target,
                  reason: cause instanceof Error ? cause.message : String(cause),
                },
              ],
            });
          }
        }
        const manifest = await timed('revision-load', () => readManifest(workspace));
        if ((manifest.schemaVersion as string) !== '2.0' || !isIntegerRevision(manifest.revision)) {
          if (command.type === 'status') {
            return ok({
              workspaceId: workspace,
              format: manifest.format,
              revision: manifest.revision,
              schemaVersion: manifest.schemaVersion,
              compatible: false,
              hint: 'Initialize a new empty destination with deckuse init to migrate to protocol 2.0.',
              capabilities: manifest.metadata?.['capabilities'],
            });
          }
        }

        const archive = await openWorkspaceArchive(workspace);
        const index = await loadIndex(workspace, archive, manifest, { persist: true });

        if (command.type === 'status') {
          const diagnostics = validateArchive(archive, workspace);
          const initialization = await initializationState(workspace);
          return ok({
            initializationState: initialization?.state ?? 'committed',
            ...(initialization ? { initializationMarker: initialization.marker } : {}),
            workspaceId: workspace,
            format: manifest.format,
            revision: manifest.revision,
            schemaVersion: manifest.schemaVersion,
            compatible: true,
            adapterVersion: manifest.adapterVersion,
            source: manifest.source,
            package: packagePath(workspace),
            health: await historyHealth(workspace),
            packageStale: await isPackageStale(workspace, manifest),
            elementCount: index.elements.length,
            pageSize: describeSlideSize(archive),
            capabilities: pptxCapabilities,
            ...editionMetadata,
            branch: 'main',
            valid: !diagnostics.some((d) => d.severity === 'error'),
            diagnostics,
          });
        }

        if (command.type === 'list') {
          const listed = listResource(archive, index, command.resource, {
            ...(command.slide !== undefined ? { slide: command.slide } : {}),
            ...(command.master !== undefined ? { master: command.master } : {}),
            ...(command.layout !== undefined ? { layout: command.layout } : {}),
          });
          if (typeof listed === 'object' && 'ok' in listed && !listed.ok) return listed;
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
          if (!details.ok) return details;
          return ok(details.value);
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

        if (command.type === 'find') {
          return await rankFind({
            candidates: collectPptxFindCandidates(index, command),
            query: command.query,
            limit: command.limit,
            model: command.model,
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
            if (!details.ok) return details;
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
              properties: details.value.properties,
              warnings: details.value.warnings,
            });
          }
          if (command.ref) {
            const item = findIndexed(index, command.ref);
            return item ? ok(item) : err('ELEMENT_NOT_FOUND', 'Element reference was not found');
          }
          return ok({
            document: {
              format: 'pptx',
              revision: index.revision,
              capabilities: pptxCapabilities,
              pageSize: describeSlideSize(archive),
            },
            elements: index.elements,
          });
        }

        if (command.type === 'query') {
          let matched: typeof index.elements;
          try {
            matched = index.elements.filter(pptxSelector(command.selector, index));
          } catch (cause) {
            return err('INVALID_COMMAND', String(cause));
          }
          return ok({
            items: matched.slice(0, command.limit),
            total: matched.length,
            truncated: matched.length > command.limit,
          });
        }

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
                payload:
                  item.kind === 'chart' ||
                  item.kind === 'picture' ||
                  item.kind === 'video' ||
                  item.kind === 'audio'
                    ? item.payload
                    : undefined,
              })
            : err('ELEMENT_NOT_FOUND', 'Element reference was not found');
        }

        if (command.type === 'validate') {
          const expectedNames = command.expectedSlideNames;
          if (command.expectRevision && command.expectRevision !== manifest.revision)
            return err(
              'TRANSACTION_CONFLICT',
              'Workspace revision differs from the expected revision',
              [],
              {
                details: { expected: command.expectRevision, observed: manifest.revision },
              },
            );
          if (expectedNames || command.expectedSlides !== undefined) {
            const names = index.elements
              .filter((item) => item.kind === 'slide')
              .map((item) => item.name);
            const expected = command.expectedSlides ?? expectedNames?.length;
            if (
              expected !== names.length ||
              (expectedNames &&
                (new Set(expectedNames).size !== expectedNames.length ||
                  expectedNames.length !== names.length ||
                  expectedNames.some((name, i) => name !== names[i])))
            )
              return err(
                'VALIDATION_FAILED',
                'PPTX slide inventory differs from the expected inventory',
                [],
                {
                  details: {
                    expectedSlides: expected,
                    observedSlides: names.length,
                    expectedSlideNames: expectedNames,
                    observedSlideNames: names,
                  },
                },
              );
          }
          const diagnostics = validateArchive(archive, workspace);
          const chartData = await verifyChartData(archive);
          const visual = auditVisuals(archive, command.slide);
          if (command.render) diagnostics.push(...visual.diagnostics);
          else if (command.profile === 'delivery')
            diagnostics.push(...visual.diagnostics.filter((d) => d.severity === 'error'));
          diagnostics.push(...chartDataDiagnostics(chartData, command.profile === 'delivery'));

          return diagnostics.some((d) => d.severity === 'error')
            ? err(
                'VALIDATION_FAILED',
                'PPTX validation failed',
                diagnostics,
                notesRepairHintExtra(workspace, diagnostics),
              )
            : ok(
                {
                  valid: true,
                  revision: index.revision,
                  ...(command.summary
                    ? {
                        inspection: {
                          packageSha256: exportDigest(await readFile(packagePath(workspace))),
                          packageStale: await isPackageStale(workspace),
                          slideCount: index.elements.filter((item) => item.kind === 'slide').length,
                          slides: index.elements
                            .filter((item) => item.kind === 'slide')
                            .map((slide, i) => {
                              const objects = index.elements.filter(
                                (item) =>
                                  item.slideId === slide.slideId &&
                                  !['slide', 'notes', 'tableCell'].includes(item.kind),
                              );
                              return {
                                page: i + 1,
                                name: slide.name,
                                target: targetPathForItem(index, slide),
                                uid: uidForItem(slide),
                                partUri: slide.partUri,
                                objectCount: objects.length,
                                text: objects
                                  .filter((item) => item.text)
                                  .map((item) => ({
                                    target: targetPathForItem(index, item),
                                    text: item.text,
                                  })),
                              };
                            }),
                          layout: {
                            state: command.render ? 'heuristic-only' : 'not-requested',
                            diagnostics: command.render ? visual.diagnostics : [],
                          },
                          verification: {
                            structure: 'valid',
                            preview: 'not-performed',
                            visualReview: 'not-performed',
                            nativeReview: 'not-performed',
                          },
                        },
                      }
                    : {}),
                  capabilities: pptxCapabilities,
                  chartData,
                  visual,
                  diagnostics,
                },
                diagnostics,
              );
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
          const fromPackage = command.fromPackage === true;
          let repacked = false;
          let exportRevision = manifest.revision;
          if (!fromPackage) {
            const packed = await repackWorkspace(workspace);
            exportRevision = packed.manifest.revision;
            repacked = true;
          }
          const invocationId = randomUUID();
          const temporary = `${output}.${invocationId}.tmp`;
          const cleanup = async () => {
            try {
              if (managedRetirement() && dirname(temporary) !== workspace) {
                return `Preserved export staging file outside the workspace: ${temporary}`;
              }
              await timed('cleanup-export', () => retireOwnedPath(workspace, temporary));
              return undefined;
            } catch (cause) {
              if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
              return `Could not clean export staging file ${temporary}: ${String(cause)}`;
            }
          };
          try {
            await copyFile(packagePath(workspace), temporary);
            const bytes = await readFile(temporary);
            const exported = await OpcArchive.open(bytes);
            const diagnostics = validateArchive(exported, workspace);
            const chartData = await verifyChartData(exported);
            const visual = auditVisuals(exported);
            if (command.profile !== 'delivery')
              diagnostics.push(...chartDataDiagnostics(chartData, false));
            if (command.profile === 'delivery') {
              diagnostics.push(...visual.diagnostics.filter((d) => d.severity === 'error'));
              diagnostics.push(...chartDataDiagnostics(chartData, true));
              if (diagnostics.some((d) => d.severity === 'error')) {
                const cleanupWarning = await cleanup();
                return err(
                  'VALIDATION_FAILED',
                  'Delivery validation failed; output was not replaced',
                  diagnostics,
                  {
                    details: {
                      state: 'no-usable-artifact',
                      output,
                      revision: exportRevision,
                      invocationId,
                      cleanupWarning,
                    },
                  },
                );
              }
            }
            const valid = !diagnostics.some((d) => d.severity === 'error');
            try {
              await rename(temporary, output);
            } catch (cause) {
              const cleanupWarning = valid ? undefined : await cleanup();
              return err('IO_ERROR', `Could not publish export: ${String(cause)}`, diagnostics, {
                details: {
                  state: valid ? 'validated-staging' : 'no-usable-artifact',
                  output,
                  revision: exportRevision,
                  invocationId,
                  ...(valid
                    ? { stagingPath: temporary, sha256: exportDigest(bytes), valid: true }
                    : {}),
                  cleanupWarning,
                },
              });
            }
            const cleanupWarning = managedRetirement() ? undefined : await cleanup();

            return ok({
              output,
              revision: exportRevision,
              repacked,
              fromPackage,
              chartData,
              visual,
              valid,
              state: 'committed',
              invocationId,
              ...(cleanupWarning ? { warnings: [cleanupWarning] } : {}),
              diagnostics,
            });
          } catch (cause) {
            const cleanupWarning = await cleanup();
            return err('IO_ERROR', String(cause), [], {
              details: {
                state: 'no-usable-artifact',
                output,
                revision: exportRevision,
                invocationId,
                cleanupWarning,
              },
            });
          }
        }

        if (command.type === 'repair') {
          const conflict = assertExpectRevision(command, manifest.revision);
          if (conflict) return conflict;
          return await withWriteLock(workspace, async () => {
            const currentManifest = await readManifest(workspace);
            const locked = assertExpectRevision(command, currentManifest.revision);
            if (locked) return locked;
            const working = await openWorkspaceArchive(workspace);
            working.markClean();
            const planned = planNotesSlideRepairs(working);
            if (planned.ambiguous.length > 0) {
              return err(
                'AMBIGUOUS_REFERENCE',
                'Notes slide relationships cannot be repaired without ambiguity',
                planned.ambiguous,
                { hint: repairNotesHint(workspace) },
              );
            }
            if (planned.fixes.length === 0) {
              const validation = validateArchive(working, workspace);
              if (validation.some((d) => d.severity === 'error'))
                return err(
                  'VALIDATION_FAILED',
                  'PPTX validation failed',
                  validation,
                  notesRepairHintExtra(workspace, validation),
                );
              return ok({
                repaired: [],
                valid: true,
                dryRun: command.dryRun === true,
                revision: currentManifest.revision,
              });
            }
            applyNotesSlideRepairs(working, planned.fixes);
            const validation = validateArchive(working, workspace);
            if (validation.some((d) => d.severity === 'error'))
              return err(
                'VALIDATION_FAILED',
                'PPTX validation failed after notes repair',
                validation,
                notesRepairHintExtra(workspace, validation),
              );
            const changedParts = working.getDirtyParts();
            if (command.dryRun)
              return ok({
                repaired: planned.fixes,
                valid: true,
                dryRun: true,
                revision: currentManifest.revision,
                changedParts,
              });
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
            return ok({
              repaired: planned.fixes,
              valid: true,
              dryRun: false,
              revision: saved.revision,
              changedParts,
            });
          });
        }

        if (command.type === 'listComments' || command.type === 'getComment') {
          const items = slideComments(archive);
          if (command.type === 'listComments')
            return ok({ items }, validateReviewParts(archive, 'pptx'));
          const item = items.find((n) => n.id === command.id);
          return item
            ? ok(item, validateReviewParts(archive, 'pptx'))
            : err('ELEMENT_NOT_FOUND', 'Comment not found');
        }
        if (
          command.type === 'listRevisions' ||
          command.type === 'getRevision' ||
          command.type === 'readReview' ||
          command.type === 'previewRevisionDecision'
        )
          return err('UNSUPPORTED_CAPABILITY', 'Tracked revisions require DOCX');

        if (!WRITE_TYPES.has(command.type))
          return err('INVALID_COMMAND', `Unsupported command type: ${command.type}`);

        return await withWriteLock(workspace, async () => {
          const currentManifest = await readManifest(workspace);
          const requestId =
            command.type === 'batch' || command.type === 'applyTransaction'
              ? command.requestId
              : undefined;
          const digest =
            requestId && (command.type === 'batch' || command.type === 'applyTransaction')
              ? operationDigest(command)
              : undefined;
          if (requestId && digest && !command.dryRun) {
            const existing = await readApplyReceipt(workspace, requestId);
            if (existing) {
              if (existing.receipt.operationSha256 !== digest)
                return err(
                  'TRANSACTION_CONFLICT',
                  'Request ID was already used for different operations',
                );
              if (existing.receipt.rejection) {
                const { code, message } = existing.receipt.rejection;
                return err(code, message, existing.receipt.diagnostics);
              }
              const validReceipt = existing.receipt.noOpBase
                ? await isNoOpCurrent(workspace, currentManifest.revision, existing.receipt)
                : existing.active && !(await isPackageStale(workspace, currentManifest));
              if (!validReceipt)
                return err(
                  'TRANSACTION_CONFLICT',
                  'Request receipt is stale; query status before continuing',
                );
              return ok(
                { ...existing.receipt.result, replayed: true },
                existing.receipt.diagnostics,
              );
            }
          }
          const locked = assertExpectRevision(command, currentManifest.revision);
          if (locked) return locked;

          const working = await openWorkspaceArchive(workspace);
          const changedSinceStart = partChanges(working);
          let currentIndex = await loadIndex(workspace, working, currentManifest);
          const applyMutation = async (input: AtomicCommand) => {
            if (!REVIEW_WRITES.has(input.type)) {
              const result = await mutate(input, working, currentIndex);
              return result;
            }
            try {
              const value = mutateSlideComments(
                working,
                currentIndex,
                reviewWriteSchema.parse(input),
                context.now?.() ?? new Date(),
              );
              return ok(value as unknown as import('./types.js').MutationOutcome);
            } catch (cause) {
              return err(
                'UNSUPPORTED_CAPABILITY',
                cause instanceof Error ? cause.message : 'Comment write failed',
              );
            }
          };
          const STRUCTURAL_TYPES = new Set([
            'set',
            'setProperties',
            'setText',
            'replaceText',
            'groupShapes',
            'ungroupShapes',
            'mergeTableCells',
            'unmergeTableCells',
            'addShape',
            'addSlide',
            'setSlideLayout',
            'remove',
            'duplicate',
            'add',
            'replacePicture',
          ]);

          const runBatch = async (
            nestedCommands: AtomicCommand[],
            dryRun: boolean | undefined,
            operation: unknown,
          ) => {
            const recordRejection = async <T>(result: Result<T>): Promise<Result<T>> => {
              if (!result.ok && requestId && digest && !dryRun) {
                const { code, message } = result.error;
                try {
                  await writeApplyReceipt(workspace, {
                    requestId,
                    operationSha256: digest,
                    previousRevision: currentManifest.revision,
                    revision: currentManifest.revision,
                    commitToken: '',
                    result: {},
                    diagnostics: result.diagnostics,
                    rejection: { code, message },
                  });
                } catch (cause) {
                  process.stderr.write(
                    `deckuse: could not record rejected apply: ${String(cause)}\n`,
                  );
                }
              }
              return result;
            };
            const results: unknown[] = [];
            const diagnostics: Diagnostic[] = [];
            const slidePages: number[] = [];
            const touchedParts = new Set<string>();
            const changedTargets: string[] = [];
            let hadEdits = false;
            for (const nested of nestedCommands) {
              if (REVIEW_WRITES.has(nested.type)) {
                const conflict = assertExpectRevision(nested, currentManifest.revision);
                if (conflict) return recordRejection(conflict);
              }
              working.markClean();
              const result = await timed('mutation', () => applyMutation(nested));
              const dirty = working.getDirtyParts();
              hadEdits ||= dirty.length > 0;
              diagnostics.push(...result.diagnostics);
              if (!result.ok) return recordRejection(result);
              results.push(result.value);
              slidePages.push(...slidesFromOutcome(result.value));
              const currentSlides = currentIndex.elements.filter((item) => item.kind === 'slide');
              for (const page of nested.type === 'addSlide'
                ? []
                : slidesFromOutcome(result.value)) {
                const part = currentSlides[page - 1]?.partUri;
                if (part) touchedParts.add(part);
              }
              if (nested.type === 'addSlide' && result.value.partUri)
                touchedParts.add(result.value.partUri);
              if (result.value.changedTargets) changedTargets.push(...result.value.changedTargets);
              if (dirty.length || STRUCTURAL_TYPES.has(nested.type)) {
                // Shared dependencies (e.g. charts, layouts) can affect several pages.
                const local = dirty.every(
                  (part) =>
                    /^\/ppt\/(slides|notesSlides)\//.test(part) ||
                    [
                      '/ppt/presentation.xml',
                      '/ppt/_rels/presentation.xml.rels',
                      '/[Content_Types].xml',
                      '/docProps/app.xml',
                    ].includes(part),
                );
                const dirtyOwners = new Set(
                  dirty.map((part) => part.replace(/\/_rels\/([^/]+)\.rels$/, '/$1')),
                );
                currentIndex = local
                  ? timedSync('index-local', () =>
                      buildIndexImpl(
                        working,
                        currentManifest.workspaceId,
                        currentManifest.revision,
                        { index: currentIndex, dirty: dirtyOwners },
                      ),
                    )
                  : buildIndex(working, currentManifest.workspaceId, currentManifest.revision);
              }
            }
            const finalSlides = currentIndex.elements.filter((item) => item.kind === 'slide');
            slidePages.splice(
              0,
              slidePages.length,
              ...finalSlides.flatMap((item, i) => (touchedParts.has(item.partUri) ? [i + 1] : [])),
            );
            for (const result of results) {
              if (result && typeof result === 'object' && 'partUri' in result) {
                const page = finalSlides.findIndex((item) => item.partUri === result.partUri);
                if (page >= 0)
                  Object.assign(result, {
                    index: page + 1,
                    target: `slide:${String(page + 1)}`,
                    uid: finalSlides[page] ? uidForItem(finalSlides[page]) : undefined,
                  });
              }
            }
            // Heal pre-existing app.xml drift (and Notes) before the integrity gate.
            syncAppSlideCounts(working);
            const changedParts = changedSinceStart();
            const validation = validateArchive(working, workspace);
            if (validation.some((d) => d.severity === 'error'))
              return recordRejection(
                err(
                  'VALIDATION_FAILED',
                  'PPTX validation failed',
                  validation,
                  notesRepairHintExtra(workspace, validation),
                ),
              );
            const noOp = changedParts.length === 0;
            const rev =
              dryRun || noOp ? currentManifest.revision : nextRevision(currentManifest.revision);
            const value = {
              results,
              revision: rev,
              changedTargets: noOp ? [] : [...new Set(changedTargets)],
              changedParts,
              affectedSlides: noOp ? [] : mergeSlides(slidePages),
              ...(requestId ? { requestId } : {}),
              ...(dryRun ? { dryRun: true } : {}),
              ...(noOp
                ? {
                    noOp: true,
                    noOpReason: hadEdits ? 'unchanged-content' : noOpReason(diagnostics, results),
                  }
                : {}),
            };
            if (dryRun) return ok(value, diagnostics);
            if (noOp) {
              if (requestId && digest) {
                try {
                  await writeApplyReceipt(workspace, {
                    requestId,
                    operationSha256: digest,
                    previousRevision: rev,
                    revision: rev,
                    commitToken: '',
                    noOpBase: await noOpBase(workspace),
                    result: value,
                    diagnostics,
                  });
                } catch (cause) {
                  return err(
                    'IO_ERROR',
                    `Could not record no-op receipt: ${String(cause)}`,
                    diagnostics,
                  );
                }
              }
              return ok(value, diagnostics);
            }
            const nextIndex = buildIndex(working, currentManifest.workspaceId, rev);
            await persistWrite(
              workspace,
              working,
              currentManifest,
              nextIndex,
              operation,
              value.affectedSlides,
              requestId && digest
                ? {
                    requestId,
                    operationSha256: digest,
                    previousRevision: currentManifest.revision,
                    revision: rev,
                    result: value,
                    diagnostics,
                  }
                : undefined,
              changedParts,
            );
            return ok(value, diagnostics);
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

          working.markClean();
          const result = await timed('mutation', () => applyMutation(command));
          if (!result.ok) return result;
          if (command.type === 'addSlide') {
            const fresh = buildIndex(
              working,
              currentManifest.workspaceId,
              currentManifest.revision,
            );
            const slides = fresh.elements.filter((item) => item.kind === 'slide');
            const page = slides.findIndex((item) => item.partUri === result.value.partUri);
            const item = slides[page];
            if (item)
              Object.assign(result.value, {
                index: page + 1,
                target: `slide:${String(page + 1)}`,
                uid: uidForItem(item),
                slides: [page + 1],
              });
          }
          // Heal pre-existing app.xml drift (and Notes) before the integrity gate.
          syncAppSlideCounts(working);
          const changedParts = changedSinceStart();
          const validation = validateArchive(working);
          if (validation.some((d) => d.severity === 'error'))
            return err('VALIDATION_FAILED', 'PPTX validation failed', validation);
          if (command.dryRun || !changedParts.length)
            return ok(
              {
                ...result.value,
                revision: currentManifest.revision,
                ...(command.dryRun ? { dryRun: true } : {}),
                ...(!changedParts.length
                  ? { noOp: true, noOpReason: noOpReason(result.diagnostics, [result.value]) }
                  : {}),
                changedParts,
                affectedSlides: changedParts.length ? slidesFromOutcome(result.value) : [],
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
              changedParts,
              affectedSlides: slidesFromOutcome(result.value),
            },
            result.diagnostics,
          );
        });
      } catch (cause) {
        if (cause instanceof Error && cause.message.startsWith('CONNECTOR_'))
          return err('INVALID_COMMAND', cause.message, [
            {
              severity: 'error',
              code: cause.message.split(':')[0] ?? 'CONNECTOR_INVALID',
              message: cause.message,
            },
          ]);
        return err(
          cause instanceof RecoveryRequiredError
            ? 'RECOVERY_REQUIRED'
            : cause instanceof ChartDataError
              ? 'UNSUPPORTED_CAPABILITY'
              : 'IO_ERROR',
          cause instanceof Error ? cause.message : 'PPTX operation failed',
          cause instanceof ChartDataError
            ? [
                {
                  severity: 'error',
                  code: String(cause.details['reasonCode']),
                  message: cause.message,
                  details: cause.details,
                },
              ]
            : [],
        );
      }
    });
  },
};
