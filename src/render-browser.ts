import { timed } from './timing.js';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserType } from 'playwright-core';
import { createRequire } from 'node:module';

export class RenderFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'RenderFailure';
  }
}
const require = createRequire(import.meta.url);
const previewModules = {
  'playwright-core': 'playwright-core',
  echarts: 'echarts/dist/echarts.min.js',
  tailwindcss: 'tailwindcss',
  '@fortawesome/fontawesome-free': '@fortawesome/fontawesome-free/css/all.min.css',
};

export async function loadPreviewBrowser(): Promise<BrowserType> {
  const missing = Object.entries(previewModules)
    .filter(([, path]) => {
      try {
        require.resolve(path);
        return false;
      } catch {
        return true;
      }
    })
    .map(([name]) => name);
  if (missing.length)
    throw new RenderFailure(
      'RENDER_DEPENDENCIES_MISSING',
      'Install the Deckuse optional dependencies to enable preview.',
      {
        stage: 'preview-dependencies',
        retryable: false,
        missing,
      },
    );
  return (await import('playwright-core')).chromium;
}
const failed = new Map<string, RenderFailure>();
export function browserConfiguration() {
  const executablePath =
    process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] ??
    process.env['CHROME_PATH'] ??
    process.env['CHROMIUM_PATH'];
  const provider =
    process.env['DECKUSE_BROWSER_PROVIDER'] ?? (executablePath ? 'executable' : 'headless-shell');
  return {
    provider,
    executablePath,
    execution: process.env['DECKUSE_BROWSER_EXECUTION'] ?? 'unknown',
    context: process.env['DECKUSE_BROWSER_CONTEXT'] ?? 'default',
  };
}
/** Static only: never starts a browser or downloads dependencies. */
export const browserPreflight = () => timed('browser-preflight', checkBrowserPreflight);

async function checkBrowserPreflight() {
  const config = browserConfiguration();
  if (!['headless-shell', 'chrome', 'msedge', 'chromium', 'executable'].includes(config.provider))
    throw new RenderFailure('BROWSER_CONFIGURATION_INVALID', 'Unknown DECKUSE_BROWSER_PROVIDER', {
      provider: config.provider,
    });
  if (config.execution === 'denied')
    throw new RenderFailure(
      'BROWSER_HOST_DENIED',
      'Host declares browser execution unavailable. Use a host-approved worker or execution context; Deckuse will not bypass this restriction.',
      { provider: config.provider, stage: 'preflight', retryable: false },
    );
  const chromium = await loadPreviewBrowser();
  const executable =
    config.provider === 'executable'
      ? config.executablePath
      : config.provider === 'headless-shell'
        ? chromium.executablePath().replace(/chromium-(\d+)(\/.*)?$/, 'chromium_headless_shell-$1')
        : undefined;
  // Playwright resolves its own exact shell revision at launch. Its public executablePath
  // points at full Chromium, so shell availability is checked through the corresponding
  // installation directory instead of claiming an arbitrary system binary is matched.
  let executableStatus = 'unknown';
  if (config.provider === 'executable') {
    if (!executable)
      throw new RenderFailure(
        'BROWSER_CONFIGURATION_INVALID',
        'Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH for executable provider.',
      );
    try {
      await access(executable, constants.X_OK);
      executableStatus = 'available';
    } catch {
      throw new RenderFailure(
        'BROWSER_NOT_FOUND',
        'Configured browser executable is missing or not executable. Correct its path.',
        { provider: config.provider, stage: 'preflight', executable },
      );
    }
  }
  const temporaryRoot = tmpdir();
  const details = (stage: string, path: string, cause: unknown) => {
    const code = (cause as NodeJS.ErrnoException).code;
    return { stage, path, systemCode: code, retryable: code !== 'EACCES' && code !== 'EPERM' };
  };
  let probe: string;
  try {
    probe = await mkdtemp(join(temporaryRoot, 'deckuse-browser-preflight-'));
  } catch (cause) {
    throw new RenderFailure(
      'BROWSER_CACHE_UNWRITABLE',
      String(cause),
      details('profile-create', temporaryRoot, cause),
    );
  }
  const probeFile = join(probe, 'probe');
  let writeFailure: RenderFailure | undefined;
  try {
    await writeFile(probeFile, '', { flag: 'wx' });
  } catch (cause) {
    writeFailure = new RenderFailure(
      'BROWSER_CACHE_UNWRITABLE',
      String(cause),
      details('profile-write', probeFile, cause),
    );
  }
  const cleanupWarnings: { code: string; message: string; details: Record<string, unknown> }[] = [];
  try {
    await timed('cleanup-browser-preflight', () => rm(probe, { recursive: true }));
  } catch (cause) {
    cleanupWarnings.push({
      code: 'BROWSER_PREFLIGHT_CLEANUP_FAILED',
      message: String(cause),
      details: {
        ...details('profile-cleanup', probe, cause),
        retryable: false,
        retainedPath: probe,
      },
    });
  }
  if (writeFailure)
    throw new RenderFailure(writeFailure.code, writeFailure.message, {
      ...writeFailure.details,
      cleanupWarnings,
    });
  return {
    ...config,
    executableStatus,
    cacheWritable: true,
    cleanupWarnings,
    dependencyCompatibility:
      config.provider === 'headless-shell' ? 'playwright-managed' : 'unverified',
    launch: 'not-probed',
    installation:
      'Run the playwright-core CLI from this Deckuse installation with install chromium --only-shell; no download is performed by preflight.',
  };
}
export async function launchRenderBrowser(
  launch?: BrowserType['launch'],
  timeout?: number,
): Promise<Browser> {
  const config = await browserPreflight();
  for (const warning of config.cleanupWarnings)
    process.stderr.write(
      `deckuse: ${warning.code} (${String(warning.details['retainedPath'])}): ${warning.message}\n`,
    );
  const key = JSON.stringify({ ...config, cleanupWarnings: undefined });
  const previous = failed.get(key);
  if (previous && process.env['DECKUSE_BROWSER_RETRY'] !== '1') throw previous;
  try {
    const chromium = await loadPreviewBrowser();
    return await (launch ?? chromium.launch.bind(chromium))({
      headless: true,
      ...(timeout === undefined ? {} : { timeout }),
      ...(config.provider === 'executable'
        ? { executablePath: config.executablePath ?? '' }
        : config.provider === 'headless-shell'
          ? {}
          : { channel: config.provider }),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof Error && cause.name === 'TimeoutError')
      throw new RenderFailure('BROWSER_PROBE_TIMEOUT', cause.message, {
        stage: 'launch',
        provider: config.provider,
      });
    const missing =
      /Executable doesn't exist|executable.*does not exist|distribution.*not found/i.test(message);
    const registration =
      /bootstrap_check_in|MachPortRendezvous|mach_port|application.*registration/i.test(message);
    const code = missing
      ? 'BROWSER_NOT_FOUND'
      : registration
        ? 'BROWSER_HOST_REGISTRATION_FAILED'
        : 'BROWSER_LAUNCH_FAILED';
    const logDir = join(tmpdir(), 'deckuse-browser-logs');
    await mkdir(logDir, { recursive: true });
    const log = join(logDir, `launch-${String(Date.now())}.log`);
    await writeFile(log, message, { mode: 0o600 });
    const failure = new RenderFailure(
      code,
      missing
        ? 'Browser is not installed. Install the browser revision matching this Deckuse playwright-core dependency.'
        : registration
          ? 'Browser application registration failed. Ask the host for an approved browser execution context; no provider fallback was attempted.'
          : 'Browser was found but failed to launch. Inspect the launch log and host execution context before explicitly retrying; reinstalling is not assumed to fix this.',
      {
        provider: config.provider,
        stage: 'launch',
        log,
        ...(message.match(/(?:exitCode|signal)=[^\s]+/g)
          ? { processStatus: message.match(/(?:exitCode|signal)=[^\s]+/g) }
          : {}),
      },
    );
    failed.set(key, failure);
    throw failure;
  }
}
export function renderFailurePayload(cause: unknown) {
  return {
    code: cause instanceof RenderFailure ? cause.code : 'RENDER_FAILED',
    message: cause instanceof Error ? cause.message : String(cause),
    ...(cause instanceof RenderFailure ? { details: cause.details } : {}),
  };
}

/** Playwright owns the temporary profile and cancels launch on timeout. */
export async function probeRenderBrowser(launch?: BrowserType['launch']) {
  const browser = await launchRenderBrowser(launch, 5000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const page = await browser.newPage();
        await page.goto('data:text/html,<title>Deckuse browser probe</title>', { timeout: 5000 });
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            Object.assign(new Error('Browser smoke page timed out'), { name: 'TimeoutError' }),
          );
        }, 5000);
      }),
    ]);
  } catch (cause) {
    const timeout = cause instanceof Error && cause.name === 'TimeoutError';
    throw new RenderFailure(
      timeout ? 'BROWSER_PROBE_TIMEOUT' : 'BROWSER_PROBE_FAILED',
      cause instanceof Error ? cause.message : String(cause),
      { stage: 'probe-page' },
    );
  } finally {
    clearTimeout(timer);
    await browser.close();
  }
}
