import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { commitWorkspace, operationCommitMessage } from './git.js';
import { deckuseDir, operationsPath } from './paths.js';

export interface OperationRecord {
  readonly at: string;
  readonly revision: string;
  readonly operation: unknown;
  readonly slides: number[];
}

export const readOperations = async (workspace: string): Promise<OperationRecord[]> => {
  try {
    const raw = await readFile(operationsPath(workspace), 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as OperationRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

export const writeOperations = async (workspace: string, records: OperationRecord[]): Promise<void> => {
  await mkdir(deckuseDir(workspace), { recursive: true });
  const content = records.length
    ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
    : '';
  await writeFile(operationsPath(workspace), content);
};

export const appendOperationCommit = async (
  workspace: string,
  record: OperationRecord,
): Promise<string> => {
  const records = await readOperations(workspace);
  records.push(record);
  await writeOperations(workspace, records);
  return commitWorkspace(workspace, operationCommitMessage(record.operation));
};

export const readHistory = async (
  workspace: string,
  limit: number,
  offset: number,
): Promise<{ records: OperationRecord[]; total: number }> => {
  const records = await readOperations(workspace);
  return { records: records.slice(offset, offset + limit), total: records.length };
};
