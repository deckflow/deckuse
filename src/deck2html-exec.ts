import { RenderFailure } from './render-browser.js';
import { access, chmod, constants } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import type deck2html from '@deckflow/deck2html';

async function selectedBinary(): Promise<string> {
  const configured = process.env['DECKUSE_DECK2HTML_BINARY'];
  if (configured) return configured;
  try {
    return (await import('@deckflow/deck2html')).default.getBinaryPath();
  } catch (cause) {
    throw new RenderFailure(
      'RENDER_CONVERTER_MISSING',
      'Install the platform converter to enable preview.',
      {
        stage: 'converter-discovery',
        retryable: false,
        cause: String(cause),
      },
    );
  }
}

/** npm may install platform binaries without +x; restore before convert. */
export const ensureDeck2HtmlExecutable = async (): Promise<void> => {
  const binary = await selectedBinary();
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

function extractionConfiguration() {
  const base = process.env['DOTNET_BUNDLE_EXTRACT_BASE_DIR'];
  return {
    extractionBase: base === '' ? null : (base ?? null),
    extractionSource: base ? 'explicit' : 'runtime-default',
  };
}

/** Inherit host policy and runtime defaults; never relocate or warm extraction caches. */
async function runConverter(args: string[], preflight = false) {
  const binary = resolve(await selectedBinary());
  await ensureDeck2HtmlExecutable();
  const env = { ...process.env };
  return new Promise<{ stdout: string; stderr: string }>((done, reject) => {
    execFile(
      binary,
      args,
      {
        env,
        timeout: preflight ? 5000 : 120_000,
        maxBuffer: preflight ? 65536 : 64 * 1024 * 1024,
        killSignal: 'SIGKILL',
      },
      (error, stdout, stderr) => {
        if (!error) {
          done({ stdout, stderr });
          return;
        }
        const failure = converterFailure(stderr.trim() || stdout.trim() || error.message, {
          binary,
          exitCode: typeof error.code === 'number' ? error.code : null,
          systemCode: typeof error.code === 'string' ? error.code : undefined,
          signal: error.signal ?? null,
          killed: error.killed ?? false,
        });
        reject(
          preflight && failure.code !== 'RENDER_CONVERTER_EXTRACTION_FAILED'
            ? new RenderFailure('RENDER_CONVERTER_STARTUP_FAILED', failure.message, {
                ...failure.details,
                stage: 'converter-startup',
              })
            : failure,
        );
      },
    );
  });
}

/** Explicit native binary selection for testing or deploying a companion engine build. */
export const convertWithConfiguredBinary: typeof deck2html.convert = async (input, options) => {
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
  const { stdout, stderr } = await runConverter(args);
  return {
    indexHtmlPath: join(resolve(options.output), 'index.html'),
    exitCode: 0,
    stdout,
    stderr,
  };
};

/** Identify a shared .NET bundle setup failure before treating it as a page error. */
export function converterFailure(
  message: string,
  context: Record<string, unknown> = {},
): RenderFailure {
  const extraction =
    /failure processing application bundle|bundle.{0,80}extract|extract.{0,80}bundle|DOTNET_BUNDLE_EXTRACT_BASE_DIR|failed to (?:commit extracted files|create extraction directory)/i.test(
      message,
    );
  const extractionStage = /failed to commit extracted files/i.test(message)
    ? 'commit'
    : /failed to (?:create|determine).*dir|failed to determine location/i.test(message)
      ? 'directory'
      : /failed to open file|I\/O failure.*writ/i.test(message)
        ? 'write'
        : 'unknown';
  return new RenderFailure(
    extraction ? 'RENDER_CONVERTER_EXTRACTION_FAILED' : 'RENDER_CONVERSION_FAILED',
    message,
    {
      ...extractionConfiguration(),
      ...context,
      stage: extraction ? 'converter-extraction' : 'convert',
      ...(extraction
        ? {
            retryable: false,
            extractionStage,
            hint: 'Do not retry unchanged or cycle through extraction directories. Bundle startup needs host-approved write and commit operations (including rename and possibly delete), not just a writable directory. Use a non-bundled runtime distribution or have the host correct its configuration before retrying.',
          }
        : {}),
    },
  );
}

/** Run the selected binary through runtime startup without converting user content. */
export async function converterPreflight() {
  const { stdout } = await runConverter(['--version'], true);
  return {
    binary: resolve(await selectedBinary()),
    version: stdout.trim(),
    ...extractionConfiguration(),
  };
}
