import { z } from 'zod';
const read = {
  version: z.literal('2.0'),
  workspaceId: z.string().min(1),
  requestId: z.string().optional(),
};
const write = {
  ...read,
  transactionId: z.string().min(1),
  expectRevision: z.union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive()]),
  dryRun: z.boolean().optional(),
  reason: z.string().optional(),
};
export const authorSchema = z
  .object({ id: z.string().min(1), name: z.string().min(1), initials: z.string().optional() })
  .strict();
const endpoint = z
  .object({ target: z.string().min(1), offset: z.number().int().nonnegative() })
  .strict();
export const anchorSchema = z
  .object({
    target: z.string().min(1),
    start: endpoint.optional(),
    end: endpoint.optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  })
  .strict()
  .refine((a) => Boolean(a.start) === Boolean(a.end), 'Both range endpoints are required');
export const commentWrites = [
  z
    .object({
      ...write,
      type: z.literal('addComment'),
      text: z.string().min(1),
      author: authorSchema,
      anchor: anchorSchema,
      format: z.enum(['legacy', 'modern']).optional(),
    })
    .strict(),
  z
    .object({
      ...write,
      type: z.literal('updateComment'),
      id: z.string().min(1),
      text: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...write,
      type: z.literal('replyComment'),
      id: z.string().min(1),
      text: z.string().min(1),
      author: authorSchema,
    })
    .strict(),
  z.object({ ...write, type: z.literal('resolveComment'), id: z.string().min(1) }).strict(),
  z.object({ ...write, type: z.literal('reopenComment'), id: z.string().min(1) }).strict(),
  z
    .object({
      ...write,
      type: z.literal('deleteComment'),
      id: z.string().min(1),
      thread: z.boolean().optional(),
    })
    .strict(),
  z.object({ ...write, type: z.literal('upgradeComments') }).strict(),
] as const;
const operation = z.discriminatedUnion('op', [
  z
    .object({ op: z.literal('replaceText'), start: endpoint, end: endpoint, text: z.string() })
    .strict(),
  z
    .object({
      op: z.literal('setProperties'),
      target: z.string(),
      properties: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z.object({ op: z.literal('insertParagraph'), target: z.string(), text: z.string() }).strict(),
  z.object({ op: z.literal('deleteParagraph'), target: z.string() }).strict(),
  z
    .object({
      op: z.literal('splitParagraph'),
      target: z.string(),
      offset: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ op: z.literal('mergeParagraph'), target: z.string() }).strict(),
  z
    .object({
      op: z.literal('moveParagraphs'),
      target: z.string(),
      endTarget: z.string(),
      after: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.enum(['insertRow', 'deleteRow', 'insertColumn', 'deleteColumn']),
      target: z.string(),
      index: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      op: z.enum(['mergeCells', 'splitCell']),
      target: z.string(),
      row: z.number().int().nonnegative(),
      column: z.number().int().nonnegative(),
      count: z.number().int().min(2),
    })
    .strict(),
]);
export const revisionWrites = [
  z
    .object({
      ...write,
      type: z.literal('proposeChanges'),
      author: authorSchema,
      operations: z.array(operation).min(1).max(1000),
    })
    .strict(),
  z
    .object({
      ...write,
      type: z.literal('acceptRevisions'),
      ids: z.array(z.string()).min(1).optional(),
      all: z.boolean().optional(),
    })
    .strict()
    .refine((c) => Boolean(c.all) !== Boolean(c.ids), 'Select ids or all'),
  z
    .object({
      ...write,
      type: z.literal('rejectRevisions'),
      ids: z.array(z.string()).min(1).optional(),
      all: z.boolean().optional(),
    })
    .strict()
    .refine((c) => Boolean(c.all) !== Boolean(c.ids), 'Select ids or all'),
] as const;
export const reviewReads = [
  z.object({ ...read, type: z.literal('listComments') }).strict(),
  z.object({ ...read, type: z.literal('getComment'), id: z.string() }).strict(),
  z
    .object({
      ...read,
      type: z.literal('readReview'),
      view: z.enum(['original', 'final', 'markup']),
      partUri: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...read,
      type: z.literal('previewRevisionDecision'),
      decision: z.enum(['accept', 'reject']),
      ids: z.array(z.string()).min(1).optional(),
      all: z.boolean().optional(),
    })
    .strict()
    .refine((c) => Boolean(c.all) !== Boolean(c.ids), 'Select ids or all'),
] as const;
export const reviewWriteSchema = z.discriminatedUnion('type', [
  ...commentWrites,
  ...revisionWrites,
]);
export type ReviewWrite = z.infer<typeof reviewWriteSchema>;
export type ProposalOperation = z.infer<typeof operation>;
export type ReviewAuthor = z.infer<typeof authorSchema>;
export type CommentAnchor = z.infer<typeof anchorSchema>;
export const REVIEW_WRITES = new Set<string>([
  'addComment',
  'updateComment',
  'replyComment',
  'resolveComment',
  'reopenComment',
  'deleteComment',
  'upgradeComments',
  'proposeChanges',
  'acceptRevisions',
  'rejectRevisions',
]);
