import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializationState } from './initialize.js';
import { isProcessAlive, parseLockPayload } from './lock.js';
import { deckuseDir, lockPath, manifestPath } from './paths.js';
import { readApplyReceipt } from './receipts.js';

async function optional<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** A diagnostic observation. It cannot authorize a retry or substitute for locked status. */
export async function readOnlyStatus(root: string, requestId?: string) {
  async function sample() {
    const [manifest, initialization, lock, transaction, receipt] = await Promise.all([
      optional(() => readFile(manifestPath(root), 'utf8')),
      initializationState(root),
      optional(() => readFile(lockPath(root), 'utf8')),
      optional(() => lstat(join(deckuseDir(root), 'transaction'))),
      requestId ? readApplyReceipt(root, requestId) : undefined,
    ]);
    let revision: unknown;
    if (manifest !== undefined) {
      try {
        revision = (JSON.parse(manifest) as { revision?: unknown } | null)?.revision;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    return {
      manifest,
      revision: typeof revision === 'string' ? revision : undefined,
      initialization,
      lock,
      transactionPresent: transaction !== undefined,
      receipt,
    };
  }
  const before = await sample();
  const observed = await sample();
  const holder = observed.lock === undefined ? undefined : parseLockPayload(observed.lock);
  const lockState =
    observed.lock === undefined
      ? 'absent'
      : holder === undefined
        ? 'unknown'
        : isProcessAlive(holder.pid)
          ? 'alive'
          : 'not-running';
  const stable =
    JSON.stringify(before) === JSON.stringify(observed) &&
    !observed.transactionPresent &&
    observed.revision !== undefined &&
    observed.initialization?.state !== 'initialization-incomplete' &&
    (lockState === 'absent' || lockState === 'not-running');
  return {
    readOnly: true,
    consistency: stable ? 'stable-observation' : 'unknown',
    revision: observed.revision,
    initializationState:
      observed.initialization?.state ?? (observed.revision === undefined ? 'unknown' : 'committed'),
    lock: { state: lockState, pid: holder?.pid, acquiredAt: holder?.acquiredAt },
    transactionPresent: observed.transactionPresent,
    ...(requestId
      ? {
          requestId,
          receipt:
            stable && observed.receipt
              ? {
                  state: 'observed',
                  active: observed.receipt.active,
                  revision: observed.receipt.receipt.revision,
                  operationSha256: observed.receipt.receipt.operationSha256,
                  rejected: Boolean(observed.receipt.receipt.rejection),
                  noOp: Boolean(observed.receipt.receipt.noOpBase),
                }
              : { state: stable ? 'missing' : 'unknown' },
        }
      : {}),
  };
}
