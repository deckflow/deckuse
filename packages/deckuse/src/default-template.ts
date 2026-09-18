import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the bundled blank PPTX shipped next to `dist/`. */
export const resolveDefaultPptxPath = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'default.pptx');

/** Resolve the bundled template and fail clearly if the package install is incomplete. */
export const assertDefaultPptxExists = async (): Promise<string> => {
  const path = resolveDefaultPptxPath();
  try {
    await access(path);
  } catch {
    throw new Error(
      `Bundled default template missing: ${path}. Reinstall @deckflow/deckuse or restore packages/deckuse/assets/default.pptx.`,
    );
  }
  return path;
};
