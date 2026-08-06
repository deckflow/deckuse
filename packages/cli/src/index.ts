import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AdapterRegistry, Executor, type Result } from '@deckuse/core';
import { pptxAdapter } from '@deckuse/pptx';
import { docxAdapter } from '@deckuse/docx';
import { xlsxAdapter } from '@deckuse/xlsx';
import { keyAdapter } from '@deckuse/key';
import { numbersAdapter } from '@deckuse/numbers';
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
