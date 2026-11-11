import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { operationDigest } from './workspace/receipts.js';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A report is a durable observation, never an instruction to replay a mutation. */
export async function writeApplyReport(path: string, envelope: unknown, command: unknown) {
  if (!record(envelope) || !record(command)) throw new Error('Invalid apply report input');
  const data = record(envelope['data']) ? envelope['data'] : {};
  const requestId = command['requestId'];
  const workspace = command['workspaceId'];
  const identity =
    typeof requestId === 'string' && typeof workspace === 'string'
      ? createHash('sha256')
          .update(
            JSON.stringify({
              workspace: resolve(workspace),
              requestId,
              revision: data['revision'],
              digest: operationDigest(command as Parameters<typeof operationDigest>[0]),
              dryRun: command['dryRun'] === true,
            }),
          )
          .digest('hex')
      : undefined;
  const report = { ...envelope, reportIdentity: identity };
  try {
    await writeFile(path, JSON.stringify(report) + '\n', { flag: 'wx' });
    return { status: 'written' as const, warnings: envelope['warnings'] };
  } catch (cause) {
    if (
      (cause as NodeJS.ErrnoException).code !== 'EEXIST' ||
      !identity ||
      envelope['ok'] !== true ||
      data['replayed'] !== true
    )
      throw cause;
    const previous: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!record(previous) || previous['ok'] !== true || previous['reportIdentity'] !== identity)
      throw new Error('Existing report belongs to different work; preserved without overwrite', {
        cause,
      });
    const committedFields = [
      'requestId',
      'revision',
      'results',
      'changedParts',
      'changedTargets',
      'affectedSlides',
      'noOp',
      'noOpReason',
      'dryRun',
    ];
    const previousData = previous['data'];
    if (
      !record(previousData) ||
      committedFields.some((key) => JSON.stringify(previousData[key]) !== JSON.stringify(data[key]))
    )
      throw new Error(
        'Existing report result differs from the receipt; preserved without overwrite',
        { cause },
      );
    // Preserve first-attempt cleanup evidence as well as the original report bytes.
    return { status: 'reused' as const, warnings: previous['warnings'] };
  }
}
