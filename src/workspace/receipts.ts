import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Diagnostic } from '../core/index.js';
import { readOperations } from './operations.js';

export interface ApplyReceipt {
  requestId: string;
  operationSha256: string;
  previousRevision: string;
  revision: string;
  commitToken: string;
  result: Record<string, unknown>;
  diagnostics: Diagnostic[];
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const directory = (root: string) => join(root, '.deckuse', 'receipts');
const pathFor = (root: string, id: string) => join(directory(root), hash(id) + '.json');

// The CLI supplies the current transaction revision on each attempt. The
// precondition is checked separately from the identity of the submitted work.
export function operationDigest(command: {
  type: string;
  commands?: readonly unknown[];
  operations?: readonly unknown[];
}): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  };
  const metadata = new Set([
    'workspaceId',
    'transactionId',
    'requestId',
    'reason',
    'expectRevision',
  ]);
  const commands = command.commands?.map((item) =>
    Object.fromEntries(
      Object.entries(item as Record<string, unknown>).filter(([key]) => !metadata.has(key)),
    ),
  );
  return hash(
    JSON.stringify(canonical({ type: command.type, commands, operations: command.operations })),
  );
}

export async function readApplyReceipt(root: string, id: string) {
  try {
    const receipt = JSON.parse(await readFile(pathFor(root, id), 'utf8')) as ApplyReceipt;
    const latest = (await readOperations(root)).at(-1);
    return { receipt, current: latest?.commitToken === receipt.commitToken };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeApplyReceipt(root: string, receipt: ApplyReceipt) {
  await mkdir(directory(root), { recursive: true });
  await writeFile(pathFor(root, receipt.requestId), JSON.stringify(receipt));
}
