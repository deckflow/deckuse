import { afterEach, expect, it, vi } from 'vitest';
import { browserPreflight, launchRenderBrowser } from '../../src/render-browser.js';
afterEach(() => vi.unstubAllEnvs());
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
