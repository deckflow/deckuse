import { RenderFailure } from './render-browser.js';
import { access, chmod, constants, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
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

const defaultExtractionBase = () => join(homedir(), '.cache', 'deckuse', 'dotnet');
const extractionBase = () =>
  process.env['DOTNET_BUNDLE_EXTRACT_BASE_DIR'] ?? defaultExtractionBase();

async function converterEnvironment() {
  const base = extractionBase();
  if (!process.env['DOTNET_BUNDLE_EXTRACT_BASE_DIR']) {
    try {
      await mkdir(base, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw converterFailure(`Failed to create extraction directory ${base}: ${String(error)}`);
    }
  }
  return { ...process.env, DOTNET_BUNDLE_EXTRACT_BASE_DIR: base };
}

/** Explicit native binary selection for testing or deploying a companion engine build. */
export const convertWithConfiguredBinary: typeof deck2html.convert = async (input, options) => {
  const binary = process.env['DECKUSE_DECK2HTML_BINARY'] ?? deck2html.getBinaryPath();
  const env = await converterEnvironment();
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
    execFile(
      resolve(binary),
      args,
      { env, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
      (error, stdout, stderr) => {
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
      },
    ),
  );
};

/** Identify a shared .NET bundle setup failure before treating it as a page error. */
export function converterFailure(message: string): RenderFailure {
  const extraction =
    /bundle.{0,80}extract|extract.{0,80}bundle|DOTNET_BUNDLE_EXTRACT_BASE_DIR|failed to (?:commit extracted files|create extraction directory)/i.test(
      message,
    );
  return new RenderFailure(
    extraction ? 'RENDER_CONVERTER_EXTRACTION_FAILED' : 'RENDER_CONVERSION_FAILED',
    message,
    {
      stage: extraction ? 'converter-extraction' : 'convert',
      ...(extraction
        ? {
            retryable: false,
            extractionBase: extractionBase(),
            hint: 'Verify the converter can create and commit files in its extraction directory under the host policy before retrying preview.',
          }
        : {}),
    },
  );
}

/** Run the selected binary through runtime startup without converting user content. */
export async function converterPreflight() {
  const binary = process.env['DECKUSE_DECK2HTML_BINARY'] ?? deck2html.getBinaryPath();
  const { execFile } = await import('node:child_process');
  const { resolve } = await import('node:path');
  await ensureDeck2HtmlExecutable();
  const env = await converterEnvironment();
  const version = await new Promise<string>((done, reject) => {
    execFile(
      resolve(binary),
      ['--version'],
      { env, timeout: 5000, maxBuffer: 65536, killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr.trim() || error.message;
          const failure = converterFailure(message);
          reject(
            failure.code === 'RENDER_CONVERTER_EXTRACTION_FAILED'
              ? failure
              : new RenderFailure('RENDER_CONVERTER_STARTUP_FAILED', message, {
                  stage: 'converter-startup',
                }),
          );
        } else done(stdout.trim());
      },
    );
  });
  return {
    binary,
    version,
    extractionBase: extractionBase(),
    extractionSource: process.env['DOTNET_BUNDLE_EXTRACT_BASE_DIR'] ? 'explicit' : 'deckuse-cache',
  };
}
