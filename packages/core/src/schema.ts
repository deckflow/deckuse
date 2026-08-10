import { z } from 'zod';

export const PROTOCOL_VERSION = '1.0' as const;
export const protocolVersionSchema = z.literal(PROTOCOL_VERSION);

export const errorCodeSchema = z.enum([
  'INVALID_COMMAND',
  'UNSUPPORTED_VERSION',
  'WORKSPACE_NOT_FOUND',
  'DOCUMENT_NOT_FOUND',
  'ELEMENT_NOT_FOUND',
  'AMBIGUOUS_REFERENCE',
  'FORMAT_NOT_SUPPORTED',
  'FORMAT_NOT_IMPLEMENTED',
  'VALIDATION_FAILED',
  'TRANSACTION_CONFLICT',
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

const commandBase = {
  version: protocolVersionSchema,
  requestId: z.string().min(1).optional(),
} as const;
const mutationBase = {
  workspaceId: z.string().min(1),
  transactionId: z.string().min(1),
  dryRun: z.boolean().optional(),
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

const inspectCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('inspect'),
    workspaceId: z.string().min(1),
    ref: elementRefSchema.optional(),
    depth: z.number().int().min(0).max(100).default(1),
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
    ref: elementRefSchema,
    text: z.string(),
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
    ref: elementRefSchema,
    properties: z.record(z.string(), z.unknown()),
  })
  .strict();
const setTransformCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('setTransform'),
    ref: elementRefSchema,
    transform: transformSchema,
  })
  .strict();
const addCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('add'),
    parent: elementRefSchema,
    element: z.record(z.string(), z.unknown()),
  })
  .strict();
const removeCommandSchema = z
  .object({ ...commandBase, ...mutationBase, type: z.literal('remove'), ref: elementRefSchema })
  .strict();
const replacePictureCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('replacePicture'),
    ref: elementRefSchema,
    path: z.string().min(1).optional(),
    base64: z.string().min(1).optional(),
  })
  .strict();
const duplicateCommandSchema = z
  .object({
    ...commandBase,
    ...mutationBase,
    type: z.literal('duplicate'),
    ref: elementRefSchema,
    parent: elementRefSchema.optional(),
    index: z.number().int().nonnegative().optional(),
  })
  .strict();
const commitCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('commit'),
    workspaceId: z.string().min(1),
    transactionId: z.string().min(1),
    destination: z.string().min(1).optional(),
    overwrite: z.boolean().optional(),
  })
  .strict();
const validateCommandSchema = z
  .object({
    ...commandBase,
    type: z.literal('validate'),
    workspaceId: z.string().min(1),
    level: z.enum(['fast', 'full']).default('full'),
  })
  .strict();

export const atomicCommandSchema = z.discriminatedUnion('type', [
  setTextCommandSchema,
  replaceTextCommandSchema,
  setTransformCommandSchema,
  setPropertiesCommandSchema,
  addCommandSchema,
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
  inspectCommandSchema,
  queryCommandSchema,
  getTextCommandSchema,
  setTextCommandSchema,
  replaceTextCommandSchema,
  setTransformCommandSchema,
  setPropertiesCommandSchema,
  addCommandSchema,
  removeCommandSchema,
  replacePictureCommandSchema,
  duplicateCommandSchema,
  batchCommandSchema,
  commitCommandSchema,
  validateCommandSchema,
]);
export type Command = z.infer<typeof commandSchema>;

export const commandJsonSchema = z.toJSONSchema(commandSchema, {
  target: 'draft-2020-12',
  reused: 'ref',
});

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
): Result<T> => ({
  ok: false,
  error: { code, message, ...(diagnostics.length > 0 ? { diagnostics } : {}) },
  diagnostics,
});
