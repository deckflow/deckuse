import { access, chmod, constants } from 'node:fs/promises';
import deck2html from '@deckflow/deck2html';

/** npm may install platform binaries without +x; restore before convert. */
export const ensureDeck2HtmlExecutable = async (): Promise<void> => {
  const mod = deck2html as { getBinaryPath?: () => string };
  if (typeof mod.getBinaryPath !== 'function') return;
  const binary = process.env['DECKUSE_DECK2HTML_BINARY'] ?? mod.getBinaryPath();
  try {
    await access(binary, constants.X_OK);
  } catch {
    try {
      await chmod(binary, 0o755);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `deck2html binary is not executable (${binary}). Tried chmod +x and failed: ${detail}`,
        { cause: error },
      );
    }
  }
};

/** Explicit native binary selection for testing or deploying a companion engine build. */
export const convertWithConfiguredBinary: typeof deck2html.convert = async (input, options) => {
  const binary = process.env['DECKUSE_DECK2HTML_BINARY'];
  if (!binary) return deck2html.convert(input, options);
  const { execFile } = await import('node:child_process');
  const { resolve, join } = await import('node:path');
  const args = [resolve(input), '-o', resolve(options.output)];
  for (const [key, flag] of [
    ['mode', '--mode'],
    ['license', '--license'],
    ['fontService', '--font-service'],
    ['pages', '--pages'],
  ] as const) {
    const value = options[key];
    if (value) args.push(flag, value);
  }
  for (const [key, flag] of [
    ['verbose', '--verbose'],
    ['noPlayer', '--no-player'],
    ['notes', '--notes'],
    ['includeHiddenSlides', '--include-hidden-slides'],
    ['includeMasters', '--include-masters'],
    ['includeLayouts', '--include-layouts'],
    ['noLazySlides', '--no-lazy-slides'],
  ] as const)
    if (options[key]) args.push(flag);
  return new Promise((done, reject) =>
    execFile(resolve(binary), args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') {
        reject(new Error(error.message, { cause: error }));
        return;
      }
      done({
        indexHtmlPath: join(resolve(options.output), 'index.html'),
        exitCode: typeof error?.code === 'number' ? error.code : 0,
        stdout,
        stderr,
      });
    }),
  );
};
