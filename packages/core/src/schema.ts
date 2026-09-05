import { z } from 'zod';

export const PROTOCOL_VERSION = '2.0' as const;
export const protocolVersionSchema = z.literal(PROTOCOL_VERSION);

export const errorCodeSchema = z.enum([
  'INVALID_COMMAND',
  'UNSUPPORTED_VERSION',
  'WORKSPACE_NOT_FOUND',
  'DOCUMENT_NOT_FOUND',
  'ELEMENT_NOT_FOUND',
  'TARGET_NOT_FOUND',
  'AMBIGUOUS_REFERENCE',
  'AMBIGUOUS_NAME',
  'FORMAT_NOT_SUPPORTED',
  'FORMAT_NOT_IMPLEMENTED',
  'VALIDATION_FAILED',
  'TRANSACTION_CONFLICT',
  'UNSUPPORTED_CAPABILITY',
  'IO_ERROR',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const diagnosticSchema = z
  .object({
    severity: z.enum(['info', 'warning', 'error']),
    code: z.string().min(1),
    message: z.string().min(1),
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type Diagnostic = z.infer<typeof diagnosticSchema>;

export const elementRefSchema = z
  .object({
    documentId: z.string().min(1),
    elementId: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    revision: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => value.elementId !== undefined || value.path !== undefined, {
    message: 'elementId or path is required',
  });
export type ElementRef = z.infer<typeof elementRefSchema>;

/** Phase-1 semantic address, e.g. slide:6/shape:7 or slide:6/shape:title/text */
export const targetPathSchema = z.string().min(1);
export type TargetPath = z.infer<typeof targetPathSchema>;

export const transformSchema = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    rotation: z.number().optional(),
    flipHorizontal: z.boolean().optional(),
    flipVertical: z.boolean().optional(),
  })
  .strict();
export type Transform = z.infer<typeof transformSchema>;

export const resolveModeSchema = z.enum(['effective', 'direct', 'both']);
export type ResolveMode = z.infer<typeof resolveModeSchema>;

export const writeScopeSchema = z.enum(['local', 'placeholder', 'layout', 'master', 'theme']);
export type WriteScope = z.infer<typeof writeScopeSchema>;

const commandBase = {
  version: protocolVersionSchema,
  requestId: z.string().min(1).optional(),
} as const;
const mutationBase = {
  workspaceId: z.string().min(1),
  transactionId: z.string().min(1),
  dryRun: z.boolean().optional(),
  expectRevision: z.union([z.string().min(1), z.number().int().positive()]).optional(),
  reason: z.string().min(1).optional(),
} as const;

const initCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('init'),
    workspaceId: z.string().min(1),
    format: z.string().min(1),
    source: z.string().min(1),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const selectorObjectSchema = z
  .object({
    kind: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    textRegex: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    slide: z.string().min(1).optional(),
    hasText: z.boolean().optional(),
  })
  .strict();
export const selectorSchema = z.union([z.string().min(1), selectorObjectSchema]);
export type Selector = z.infer<typeof selectorSchema>;

const statusCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('status'),
    workspaceId: z.string().min(1),
  })
  .strict();

const listCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('list'),
    workspaceId: z.string().min(1),
    resource: z.enum(['slides', 'shapes', 'layouts', 'masters', 'theme']),
    slide: z.number().int().positive().optional(),
  })
  .strict();

const getCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('get'),
    workspaceId: z.string().min(1),
    target: z.string().min(1),
    resolve: resolveModeSchema.default('both'),
    props: z.array(z.string().min(1)).optional(),
    provenance: z.boolean().optional(),
  })
  .strict();

const searchCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('search'),
    workspaceId: z.string().min(1),
    kind: z.enum(['text', 'shape']),
    query: z.string().optional(),
    name: z.string().min(1).optional(),
    scope: z.string().min(1).optional(),
    limit: z.number().int().positive().max(10000).default(100),
  })
  .strict();

const inspectCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('inspect'),
    workspaceId: z.string().min(1),
    target: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    depth: z.number().int().min(0).max(100).default(1),
    visualTree: z.boolean().optional(),
  })
  .strict();

const queryCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('query'),
    workspaceId: z.string().min(1),
    selector: selectorSchema,
    limit: z.number().int().positive().max(10000).default(100),
  })
  .strict();

const getTextCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('getText'),
    workspaceId: z.string().min(1),
    ref: elementRefSchema,
  })
  .strict();

const setTextCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('setText'),
    ref: elementRefSchema.optional(),
    target: z.string().min(1).optional(),
    text: z.string().optional(),
    value: z.string().optional(),
  })
  .strict();

const replaceTextCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('replaceText'),
    find: z.string().min(1),
    replace: z.string(),
    regex: z.boolean().optional(),
    selector: selectorSchema.optional(),
    limit: z.number().int().positive().max(10000).optional(),
  })
  .strict();

const setPropertiesCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('setProperties'),
    ref: elementRefSchema.optional(),
    target: z.string().min(1).optional(),
    properties: z.record(z.string(), z.unknown()),
    scope: writeScopeSchema.optional(),
  })
  .strict();

const setCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('set'),
    target: z.string().min(1),
    properties: z.record(z.string(), z.unknown()),
    scope: writeScopeSchema.default('local'),
  })
  .strict();

const setTransformCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('setTransform'),
    ref: elementRefSchema.optional(),
    target: z.string().min(1).optional(),
    transform: transformSchema,
  })
  .strict();

const xfrmSetCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('xfrmSet'),
    target: z.string().min(1).optional(),
    slide: z.number().int().positive().optional(),
    shape: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    rotation: z.number().optional(),
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
  })
  .strict();

const zMoveCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('zMove'),
    target: z.string().min(1),
    above: z.string().min(1).optional(),
    below: z.string().min(1).optional(),
    toFront: z.boolean().optional(),
    toBack: z.boolean().optional(),
  })
  .strict();

const addCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('add'),
    parent: elementRefSchema.optional(),
    target: z.string().min(1).optional(),
    element: z.record(z.string(), z.unknown()),
  })
  .strict();

const addSlideCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('addSlide'),
    after: z.number().int().nonnegative().optional(),
    layout: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  })
  .strict();

const chartDataSchema = z
  .object({
    title: z.string().optional(),
    categories: z.array(z.string()).default([]),
    series: z
      .array(
        z
          .object({
            name: z.string().min(1),
            values: z.array(z.number()),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const addShapeCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('addShape'),
    slide: z.number().int().positive(),
    shapeType: z.enum([
      'text',
      'rect',
      'rounded-rect',
      'ellipse',
      'line',
      'image',
      'group',
      'table',
      'chart',
      'video',
      'audio',
    ]),
    name: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    file: z.string().min(1).optional(),
    text: z.string().optional(),
    rows: z.array(z.array(z.string())).optional(),
    chartType: z.enum(['bar', 'column', 'line', 'pie']).optional(),
    data: chartDataSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.shapeType === 'image' ||
        value.shapeType === 'video' ||
        value.shapeType === 'audio') &&
      !value.file
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `--type ${value.shapeType} requires --file <path> (example: deckuse add shape --slide 1 --type ${value.shapeType} --file ./media)`,
        path: ['file'],
      });
    }
    if (value.shapeType === 'table' && !value.rows) {
      ctx.addIssue({
        code: 'custom',
        message:
          "--type table requires --rows '<json>' (example: --rows '[[\"A\",\"B\"],[\"1\",\"2\"]]')",
        path: ['rows'],
      });
    }
    if (value.shapeType === 'chart') {
      if (!value.chartType) {
        ctx.addIssue({
          code: 'custom',
          message:
            '--type chart requires --chart-type <bar|column|line|pie> (example: --chart-type column --data \'{"categories":["Q1"],"series":[{"name":"S1","values":[1]}]}\')',
          path: ['chartType'],
        });
      }
      if (!value.data) {
        ctx.addIssue({
          code: 'custom',
          message:
            '--type chart requires --data \'<json>\' with categories + series (example: --data \'{"categories":["Q1","Q2"],"series":[{"name":"2024","values":[10,20]}]}\')',
          path: ['data'],
        });
      }
    }
  });

const removeCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('remove'),
    ref: elementRefSchema.optional(),
    target: z.string().min(1).optional(),
  })
  .strict();

const replacePictureCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('replacePicture'),
    ref: elementRefSchema.optional(),
    target: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    base64: z.string().min(1).optional(),
  })
  .strict();

const duplicateCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('duplicate'),
    ref: elementRefSchema.optional(),
    target: z.string().min(1).optional(),
    parent: elementRefSchema.optional(),
    index: z.number().int().nonnegative().optional(),
  })
  .strict();

const applyTransactionCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('applyTransaction'),
    operations: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
  })
  .strict();

const exportCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('export'),
    workspaceId: z.string().min(1),
    output: z.string().min(1),
    revision: z.union([z.string().min(1), z.number().int().positive()]).optional(),
  })
  .strict();

const undoCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('undo'),
    workspaceId: z.string().min(1),
    steps: z.number().int().positive().max(1000).default(1),
  })
  .strict();

const historyCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('history'),
    workspaceId: z.string().min(1),
    limit: z.number().int().positive().max(10000).default(100),
    offset: z.number().int().nonnegative().max(1000000).default(0),
    slide: z.number().int().positive().optional(),
  })
  .strict();

const validateCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('validate'),
    workspaceId: z.string().min(1),
    level: z.enum(['fast', 'full']).default('full'),
    package: z.boolean().optional(),
    relationships: z.boolean().optional(),
    ids: z.boolean().optional(),
    render: z.boolean().optional(),
    slide: z.number().int().positive().optional(),
  })
  .strict();

export const atomicCommandSchema = z.discriminatedUnion('type', [
  setTextCommandSchema,
  replaceTextCommandSchema,
  setTransformCommandSchema,
  setPropertiesCommandSchema,
  setCommandSchema,
  xfrmSetCommandSchema,
  zMoveCommandSchema,
  addCommandSchema,
  addSlideCommandSchema,
  addShapeCommandSchema,
  removeCommandSchema,
  replacePictureCommandSchema,
  duplicateCommandSchema,
]);
export type AtomicCommand = z.infer<typeof atomicCommandSchema>;

const batchCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('batch'),
    atomic: z.boolean().default(true),
    commands: z.array(atomicCommandSchema).min(1).max(1000),
  })
  .strict();

export const commandSchema = z.discriminatedUnion('type', [
  initCommandSchema,
  statusCommandSchema,
  listCommandSchema,
  getCommandSchema,
  searchCommandSchema,
  inspectCommandSchema,
  queryCommandSchema,
  getTextCommandSchema,
  setTextCommandSchema,
  replaceTextCommandSchema,
  setTransformCommandSchema,
  setPropertiesCommandSchema,
  setCommandSchema,
  xfrmSetCommandSchema,
  zMoveCommandSchema,
  addCommandSchema,
  addSlideCommandSchema,
  addShapeCommandSchema,
  removeCommandSchema,
  replacePictureCommandSchema,
  duplicateCommandSchema,
  applyTransactionCommandSchema,
  batchCommandSchema,
  exportCommandSchema,
  undoCommandSchema,
  historyCommandSchema,
  validateCommandSchema,
]);
export type Command = z.infer<typeof commandSchema>;

export const commandJsonSchema = z.toJSONSchema(commandSchema, {
  target: 'draft-2020-12',
  reused: 'ref',
});

export const propertyValueSchema = z
  .object({
    effective: z.unknown().nullable(),
    direct: z.unknown().nullable(),
    inherited: z.boolean(),
    source: z
      .object({
        scope: z.enum(['local', 'placeholder', 'layout', 'master', 'theme', 'default']),
        target: z.string().min(1).optional(),
        path: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    unit: z.string().min(1).optional(),
  })
  .strict();
export type PropertyValue = z.infer<typeof propertyValueSchema>;

export const commandEnvelopeSchema = z
  .object({
    ok: z.boolean(),
    command: z.string().min(1),
    revision: z.number().int().nonnegative().optional(),
    commit: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    affectedSlides: z.array(z.number().int().positive()).optional(),
    changedTargets: z.array(z.string().min(1)).optional(),
    changedParts: z.array(z.string().min(1)).optional(),
    warnings: z.array(z.string()).optional(),
    data: z.unknown().optional(),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        target: z.string().min(1).optional(),
        hint: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

export const initResultSchema = z
  .object({
    workspaceId: z.string().min(1),
    format: z.string().min(1),
    source: z.string().min(1),
    revision: z.union([z.string().min(1), z.number().int().positive()]),
    elementCount: z.number().int().nonnegative(),
  })
  .strict();
export type InitResult = z.infer<typeof initResultSchema>;

export const workspaceManifestSchema = z
  .object({
    schemaVersion: protocolVersionSchema,
    workspaceId: z.string().min(1),
    format: z.string().min(1),
    source: z.string().min(1),
    revision: z.string().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    adapterVersion: z.string().min(1),
    files: z.array(
      z
        .object({
          path: z.string().min(1),
          mediaType: z.string().min(1).optional(),
          checksum: z.string().min(1),
        })
        .strict(),
    ),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type WorkspaceManifest = z.infer<typeof workspaceManifestSchema>;

export interface DeckuseError {
  code: ErrorCode;
  message: string;
  diagnostics?: Diagnostic[];
  retryable?: boolean;
  cause?: unknown;
  target?: string;
  hint?: string;
}
export type Result<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; error: DeckuseError; diagnostics: Diagnostic[] };
export const ok = <T>(value: T, diagnostics: Diagnostic[] = []): Result<T> => ({
  ok: true,
  value,
  diagnostics,
});
export const err = <T = never>(
  code: ErrorCode,
  message: string,
  diagnostics: Diagnostic[] = [],
  extra: { target?: string; hint?: string } = {},
): Result<T> => ({
  ok: false,
  error: {
    code,
    message,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...(extra.target ? { target: extra.target } : {}),
    ...(extra.hint ? { hint: extra.hint } : {}),
  },
  diagnostics,
});

export const revisionAsNumber = (revision: string | number | undefined): number | undefined => {
  if (revision === undefined) return undefined;
  if (typeof revision === 'number') return Number.isFinite(revision) ? revision : undefined;
  const n = Number(revision);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};
