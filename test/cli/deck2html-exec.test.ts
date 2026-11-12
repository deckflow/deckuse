import { afterEach, expect, it, vi } from 'vitest';
const { execFile, access } = vi.hoisted(() => ({ execFile: vi.fn(), access: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));
vi.mock('node:fs/promises', async (original) => ({ ...(await original<object>()), access }));
vi.mock('@deckflow/deck2html', () => ({ default: { getBinaryPath: () => '/converter' } }));
import {
  converterPreflight,
  convertWithConfiguredBinary,
  converterFailure,
} from '../../src/deck2html-exec.js';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it.each([undefined, '/approved/cache'])(
  'inherits extraction configuration %s for startup and conversion',
  async (base) => {
    vi.stubEnv('DOTNET_BUNDLE_EXTRACT_BASE_DIR', base);
    vi.stubEnv('DECKUSE_DECK2HTML_BINARY', '/custom/converter');
    execFile.mockImplementation((_bin, _args, _options, callback) => callback(null, '0.6.2\n', ''));
    expect(await converterPreflight()).toMatchObject({
      binary: '/custom/converter',
      extractionBase: base ?? null,
      extractionSource: base ? 'explicit' : 'runtime-default',
    });
    await convertWithConfiguredBinary('/input.pptx', {
      output: '/output',
      license: '/license',
      pages: '1',
      noLazySlides: true,
    });
    for (const call of execFile.mock.calls) {
      expect(call[0]).toBe('/custom/converter');
      expect(call[2].env).not.toBe(process.env);
      expect(call[2].env.DOTNET_BUNDLE_EXTRACT_BASE_DIR).toBe(base);
    }
    expect(execFile.mock.calls[1][1]).toEqual([
      '/input.pptx',
      '-o',
      '/output',
      '--license',
      '/license',
      '--pages',
      '1',
      '--no-lazy-slides',
    ]);
    expect(process.env.DOTNET_BUNDLE_EXTRACT_BASE_DIR).toBe(base);
  },
);
it.each([
  ['Failed to create extraction directory /cache', 'directory'],
  ['Failure processing application bundle.\nFailed to open file /cache/file for writing.', 'write'],
  [
    'Failure processing application bundle.\nFailed to commit extracted files to directory [/cache].',
    'commit',
  ],
])('classifies %s without claiming a policy denial', (message, extractionStage) => {
  expect(converterFailure(message)).toMatchObject({
    code: 'RENDER_CONVERTER_EXTRACTION_FAILED',
    details: { extractionStage, retryable: false },
  });
});
it.each([false, true])('preserves native failure context (preflight=%s)', async (preflight) => {
  execFile.mockImplementation((_bin, _args, _options, callback) =>
    callback(
      { code: 159, signal: null },
      '',
      'Failed to commit extracted files to directory [/cache]',
    ),
  );
  await expect(
    preflight ? converterPreflight() : convertWithConfiguredBinary('/input', { output: '/output' }),
  ).rejects.toMatchObject({
    code: 'RENDER_CONVERTER_EXTRACTION_FAILED',
    details: { binary: '/converter', exitCode: 159, signal: null },
  });
});
it.each([false, true])(
  'does not report a killed converter as success (preflight=%s)',
  async (preflight) => {
    execFile.mockImplementation((_bin, _args, _options, callback) =>
      callback({ code: null, signal: 'SIGKILL', killed: true, message: 'timed out' }, '', ''),
    );
    await expect(
      preflight
        ? converterPreflight()
        : convertWithConfiguredBinary('/input', { output: '/output' }),
    ).rejects.toMatchObject({
      code: preflight ? 'RENDER_CONVERTER_STARTUP_FAILED' : 'RENDER_CONVERSION_FAILED',
      details: { signal: 'SIGKILL', killed: true, exitCode: null },
    });
  },
);
