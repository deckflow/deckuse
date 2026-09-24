import { readFile } from 'node:fs/promises';
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
        } catch {
          return undefined;
        }
      },
    },
  );
export const runCommand = async (input: unknown): Promise<Result<unknown>> =>
  createDefaultExecutor().execute(input);

export { startMonitor, type MonitorHandle, type MonitorOptions } from './monitor.js';
export {
  renderPage,
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
