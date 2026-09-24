import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the bundled blank PPTX shipped next to `dist/`. */
export const resolveDefaultPptxPath = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'default.pptx');

/** Absolute path to the bundled blank DOCX shipped next to `dist/`. */
export const resolveDefaultDocxPath = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'default.docx');

/** Resolve the bundled Word template and fail clearly if the package install is incomplete. */
export const assertDefaultDocxExists = async (): Promise<string> => {
  const path = resolveDefaultDocxPath();
  try {
    await access(path);
  } catch {
    throw new Error(
      `Bundled default template missing: ${path}. Reinstall @deckflow/deckuse or restore assets/default.docx.`,
    );
  }
  return path;
};
export const assertDefaultPptxExists = async (): Promise<string> => {
  const path = resolveDefaultPptxPath();
  try {
    await access(path);
  } catch {
    throw new Error(
      `Bundled default template missing: ${path}. Reinstall @deckflow/deckuse or restore assets/default.pptx.`,
    );
  }
  return path;
};
