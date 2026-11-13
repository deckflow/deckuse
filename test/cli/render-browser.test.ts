import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import {
  browserPreflight,
  launchRenderBrowser,
  probeRenderBrowser,
  systemBrowserCandidates,
} from '../../src/render-browser.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...fs,
    access: vi.fn(fs.access),
    mkdtemp: vi.fn(fs.mkdtemp),
    rm: vi.fn(fs.rm),
    stat: vi.fn(fs.stat),
    writeFile: vi.fn(fs.writeFile),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
it('rejects host-declared denial without invoking a provider', async () => {
  vi.stubEnv('DECKUSE_BROWSER_EXECUTION', 'denied');
  const launch = vi.fn();
  await expect(launchRenderBrowser(launch)).rejects.toMatchObject({ code: 'BROWSER_HOST_DENIED' });
  expect(launch).not.toHaveBeenCalled();
});
it('reports missing explicit executables statically without launch', async () => {
  vi.stubEnv('DECKUSE_BROWSER_PROVIDER', 'executable');
  vi.stubEnv('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', '/missing/deckuse-browser');
  await expect(browserPreflight()).rejects.toMatchObject({ code: 'BROWSER_NOT_FOUND' });
});
it('does not fallback or relaunch a failed provider in the same execution context', async () => {
  vi.stubEnv('DECKUSE_BROWSER_PROVIDER', 'headless-shell');
  vi.stubEnv('DECKUSE_BROWSER_CONTEXT', 'failure-test');
  const launch = vi.fn().mockRejectedValue(new Error('process exited exitCode=1 signal=SIGABRT'));
  await expect(launchRenderBrowser(launch)).rejects.toMatchObject({
    code: 'BROWSER_LAUNCH_FAILED',
    details: { stage: 'launch', provider: 'headless-shell' },
  });
  await expect(launchRenderBrowser(launch)).rejects.toMatchObject({
    code: 'BROWSER_LAUNCH_FAILED',
  });
  expect(launch).toHaveBeenCalledTimes(1);
  vi.stubEnv('DECKUSE_BROWSER_CONTEXT', 'changed-context');
  await expect(launchRenderBrowser(launch)).rejects.toMatchObject({
    code: 'BROWSER_LAUNCH_FAILED',
  });
  expect(launch).toHaveBeenCalledTimes(2);
});

function useAutomaticBrowser(context: string) {
  for (const key of [
    'DECKUSE_BROWSER_PROVIDER',
    'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH',
    'CHROME_PATH',
    'CHROMIUM_PATH',
  ])
    vi.stubEnv(key, undefined);
  vi.stubEnv('DECKUSE_BROWSER_EXECUTION', 'allowed');
  vi.stubEnv('DECKUSE_BROWSER_CONTEXT', context);
}

it('uses system Chrome if the default shell is missing and reports the resolved provider', async () => {
  useAutomaticBrowser('auto-chrome');
  vi.stubEnv('ProgramFiles', 'C:\\Program Files');
  const chrome = systemBrowserCandidates().find(({ provider }) => provider === 'chrome');
  expect(chrome).toBeDefined();
  vi.mocked(stat).mockResolvedValue({ isFile: () => true } as Awaited<ReturnType<typeof stat>>);
  vi.mocked(access).mockResolvedValue(undefined);
  const browser = {
    newPage: vi.fn().mockResolvedValue({ goto: vi.fn().mockResolvedValue(null) }),
    close: vi.fn(),
  };
  const launch = vi
    .fn()
    .mockRejectedValueOnce(new Error("Executable doesn't exist at /missing-shell"))
    .mockResolvedValueOnce(browser);

  await expect(probeRenderBrowser(launch)).resolves.toEqual({ resolvedProvider: 'chrome' });
  expect(launch.mock.calls).toEqual([
    [{ headless: true, timeout: 5000 }],
    [{ headless: true, timeout: 5000, channel: 'chrome', executablePath: chrome?.executablePath }],
  ]);
  expect(browser.close).toHaveBeenCalledOnce();
});

it('returns the install command when the shell and system browsers are absent', async () => {
  useAutomaticBrowser('auto-no-browser');
  vi.mocked(stat).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  const launch = vi.fn().mockRejectedValue(new Error("Executable doesn't exist at /missing-shell"));
  await expect(launchRenderBrowser(launch)).rejects.toMatchObject({
    code: 'BROWSER_NOT_FOUND',
    message: expect.stringContaining('deckuse render --install-browser'),
    details: {
      provider: 'headless-shell',
      checkedProviders: expect.arrayContaining(['headless-shell']),
      installCommand: 'deckuse render --install-browser',
    },
  });
  expect(launch).toHaveBeenCalledOnce();
});

it.each([
  ['auto', 'MachPortRendezvous failed', 'BROWSER_HOST_REGISTRATION_FAILED'],
  ['headless-shell', "Executable doesn't exist at /missing-shell", 'BROWSER_NOT_FOUND'],
])(
  'keeps the primary %s browser failure when fallback is inapplicable',
  async (provider, message, code) => {
    useAutomaticBrowser(`no-fallback-${provider}`);
    vi.stubEnv('DECKUSE_BROWSER_PROVIDER', provider);
    const launch = vi.fn().mockRejectedValue(new Error(message));
    await expect(launchRenderBrowser(launch)).rejects.toMatchObject({ code });
    expect(launch).toHaveBeenCalledOnce();
    expect(stat).not.toHaveBeenCalled();
  },
);

it('rejects browser install combined with rendering flags before running the installer', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    ['dist/bin.js', 'render', '--install-browser', '--page', '1', '--json'],
    { encoding: 'utf8' },
  );
  expect(result.status).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: false,
    error: { code: 'INVALID_ARGUMENT' },
  });
});
it('returns a migration contract for removed render engines before workspace discovery', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    ['dist/bin.js', 'render', '--engine', 'libreoffice', '--json'],
    { encoding: 'utf8' },
  );
  expect(result.status).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: false,
    error: { code: 'RENDER_ENGINE_REMOVED' },
  });
});

it('probes a trivial page with bounded launch and closes the browser on page timeout', async () => {
  const { probeRenderBrowser } = await import('../../src/render-browser.js');
  vi.stubEnv('DECKUSE_BROWSER_CONTEXT', 'probe-test');
  vi.stubEnv('DECKUSE_BROWSER_PROVIDER', 'headless-shell');
  const goto = vi.fn().mockResolvedValue(null);
  const close = vi.fn().mockResolvedValue(undefined);
  const browser = { newPage: vi.fn().mockResolvedValue({ goto }), close };
  const launch = vi.fn().mockResolvedValue(browser);
  await probeRenderBrowser(launch);
  expect(launch).toHaveBeenCalledWith(expect.objectContaining({ timeout: 5000 }));
  expect(goto).toHaveBeenCalledWith(expect.stringMatching(/^data:text\/html/), { timeout: 5000 });
  goto.mockRejectedValue(Object.assign(new Error('Timeout'), { name: 'TimeoutError' }));
  await expect(probeRenderBrowser(launch)).rejects.toMatchObject({ code: 'BROWSER_PROBE_TIMEOUT' });
  expect(close).toHaveBeenCalledTimes(2);
});

it.each([
  ['mkdtemp', 'BROWSER_CACHE_UNWRITABLE', 'profile-create'],
  ['writeFile', 'BROWSER_CACHE_UNWRITABLE', 'profile-write'],
] as const)('reports a denied %s probe at its own stage', async (method, code, stage) => {
  vi.stubEnv('DECKUSE_BROWSER_PROVIDER', 'headless-shell');
  vi.stubEnv('DECKUSE_BROWSER_EXECUTION', 'unknown');
  const operation = method === 'mkdtemp' ? mkdtemp : writeFile;
  vi.mocked(operation).mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
  await expect(browserPreflight()).rejects.toMatchObject({
    code,
    details: { stage, systemCode: 'EACCES', retryable: false },
  });
});

it('retains denied cleanup as a warning and preserves a primary write failure', async () => {
  vi.stubEnv('DECKUSE_BROWSER_PROVIDER', 'headless-shell');
  vi.stubEnv('DECKUSE_BROWSER_EXECUTION', 'unknown');
  const denied = Object.assign(new Error('denied'), { code: 'EPERM' });
  vi.mocked(mkdtemp).mockResolvedValue('/probe-retained');
  vi.mocked(writeFile).mockResolvedValue(undefined);
  vi.mocked(rm).mockRejectedValue(denied);
  await expect(browserPreflight()).resolves.toMatchObject({
    cacheWritable: true,
    cleanupWarnings: [
      { code: 'BROWSER_PREFLIGHT_CLEANUP_FAILED', details: { retainedPath: '/probe-retained' } },
    ],
  });
  vi.mocked(writeFile).mockRejectedValue(denied);
  await expect(browserPreflight()).rejects.toMatchObject({
    code: 'BROWSER_CACHE_UNWRITABLE',
    details: {
      stage: 'profile-write',
      cleanupWarnings: [{ code: 'BROWSER_PREFLIGHT_CLEANUP_FAILED' }],
    },
  });
  expect(rm).toHaveBeenCalledTimes(2);
});
