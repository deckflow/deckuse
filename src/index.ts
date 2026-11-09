import { collectCleanupWarnings } from './workspace/cleanup.js';
import type { Diagnostic } from './core/index.js';
import { initializationState } from './workspace/initialize.js';
import { withWriteLock } from './workspace/lock.js';
import { recoverTransaction } from './workspace/transaction.js';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AdapterRegistry, Executor, type Result } from './core/index.js';
import { pptxAdapter } from './pptx/index.js';
import { docxAdapter } from './docx/index.js';
import { xlsxAdapter } from './xlsx/index.js';
import { keyAdapter } from './key/index.js';
import { numbersAdapter } from './numbers/index.js';
export const createDefaultExecutor = (): Executor =>
  new Executor(
    new AdapterRegistry()
      .register(pptxAdapter)
      .register(docxAdapter)
      .register(xlsxAdapter)
      .register(keyAdapter)
      .register(numbersAdapter),
    {
      resolveAdapter: async (workspaceId) => {
        try {
          if ((await initializationState(workspaceId))?.state === 'initialization-incomplete')
            return pptxAdapter;
          await access(join(workspaceId, '.deckuse'));
          await withWriteLock(workspaceId, () => recoverTransaction(workspaceId));
          const manifest = JSON.parse(
            await readFile(join(resolve(workspaceId), '.deckuse', 'manifest.json'), 'utf8'),
          ) as { format?: string };
          return manifest.format
            ? new AdapterRegistry()
                .register(pptxAdapter)
                .register(docxAdapter)
                .register(xlsxAdapter)
                .register(keyAdapter)
                .register(numbersAdapter)
                .get(manifest.format)
            : undefined;
        } catch (cause) {
          if (cause instanceof Error && cause.name === 'RecoveryRequiredError') return pptxAdapter;
          return undefined;
        }
      },
    },
  );
export const runCommand = async (input: unknown): Promise<Result<unknown>> => {
  const warnings: Diagnostic[] = [];
  const result = await collectCleanupWarnings(warnings, () =>
    createDefaultExecutor().execute(input),
  );
  if (!warnings.length) return result;
  const diagnostics = [...result.diagnostics, ...warnings];
  if (result.ok && result.value && typeof result.value === 'object' && !Array.isArray(result.value))
    return { ...result, diagnostics, value: { ...result.value, cleanupWarnings: warnings } };
  return { ...result, diagnostics };
};

export { startMonitor, type MonitorHandle, type MonitorOptions } from './monitor.js';
export {
  renderPage,
  renderPages,
  parsePageSelection,
  type RenderPagesOptions,
  type RenderPagesResult,
  type RenderDependencies,
  type RenderOptions,
  type RenderResult,
} from './render.js';
export {
  EDITION,
  EDITION_VARIANT,
  DISTRIBUTION_CHANNEL,
  editionCapabilities,
  editionMetadata,
  type Edition,
  type EditionCapabilities,
} from './edition.js';

export type { TrackedRevision } from './docx/revisions.js';

export type { NativeComment } from './docx/comments.js';
export type {
  ReviewWrite,
  ReviewAuthor,
  CommentAnchor,
  ProposalOperation,
} from './review/schema.js';

/** Compare protocol numeric projections with raw workspace/history counters. */
export { revisionAsNumber } from './core/schema.js';

/** Initialize a new PPTX from the bundled blank template. Length numbers are EMU. */
export async function createPresentation(
  workspace: string,
  options: { pageSize?: { width: number | string; height: number | string } } = {},
): Promise<Result<unknown>> {
  const { assertDefaultPptxExists } = await import('./default-template.js');
  return createDefaultExecutor().execute({
    version: '2.0',
    type: 'init',
    workspaceId: resolve(workspace),
    format: 'pptx',
    source: await assertDefaultPptxExists(),
    ...options,
  });
}
