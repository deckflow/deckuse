import { access, chmod, constants } from 'node:fs/promises';
import deck2html from '@deckflow/deck2html';

/** npm may install platform binaries without +x; restore before convert. */
export const ensureDeck2HtmlExecutable = async (): Promise<void> => {
  const mod = deck2html as { getBinaryPath?: () => string };
  if (typeof mod.getBinaryPath !== 'function') return;
  const binary = mod.getBinaryPath();
  try {
    await access(binary, constants.X_OK);
  } catch {
    try {
      await chmod(binary, 0o755);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `deck2html binary is not executable (${binary}). Tried chmod +x and failed: ${detail}`,
      );
    }
  }
};
