import { timed } from './timing.js';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import type { Browser, BrowserType } from 'playwright-core';

const require = createRequire(import.meta.url);
const installCommand = 'deckuse render --install-browser';

export async function installRenderBrowser() {
  let manifestPath: string;
  try {
    manifestPath = require.resolve('playwright-core/package.json');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw cause;
    throw missingPreviewDependencies(['playwright-core']);
  }
  const manifest = require(manifestPath) as {
    version: string;
    bin: { 'playwright-core': string };
  };
  const cli = join(dirname(manifestPath), manifest.bin['playwright-core']);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium', '--only-shell'], {
      stdio: ['ignore', 2, 2],
    });
    child.once('error', (cause) => {
      reject(new RenderFailure('BROWSER_INSTALL_FAILED', cause.message));
    });
    child.once('close', (exitCode, signal) => {
      if (exitCode === 0) resolve();
      else
        reject(
          new RenderFailure(
            'BROWSER_INSTALL_FAILED',
            'Playwright browser installation failed. See stderr.',
            {
              exitCode,
              signal,
              playwrightVersion: manifest.version,
            },
          ),
        );
    });
  });
  return { provider: 'headless-shell', playwrightVersion: manifest.version };
}

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
const previewModules = {
  'playwright-core': 'playwright-core',
  echarts: 'echarts/dist/echarts.min.js',
  tailwindcss: 'tailwindcss',
  '@fortawesome/fontawesome-free': '@fortawesome/fontawesome-free/css/all.min.css',
};

function missingPreviewDependencies(missing: string[]) {
  return new RenderFailure(
    'RENDER_DEPENDENCIES_MISSING',
    'Install the Deckuse optional dependencies to enable preview.',
    { stage: 'preview-dependencies', retryable: false, missing },
  );
}

function checkPreviewDependencies() {
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
  if (missing.length) throw missingPreviewDependencies(missing);
}

export async function loadPreviewBrowser(): Promise<BrowserType> {
  checkPreviewDependencies();
  return (await import('playwright-core')).chromium;
}
const failed = new Map<string, RenderFailure>();
export function browserConfiguration() {
  const executablePath =
    process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] ??
    process.env['CHROME_PATH'] ??
    process.env['CHROMIUM_PATH'];
  const provider =
    process.env['DECKUSE_BROWSER_PROVIDER'] ?? (executablePath ? 'executable' : 'auto');
  return {
    provider,
    executablePath,
    execution: process.env['DECKUSE_BROWSER_EXECUTION'] ?? 'unknown',
    context: process.env['DECKUSE_BROWSER_CONTEXT'] ?? 'default',
  };
}

/** Standard system locations. Windows also has per-user Chrome and Edge installations. */
export function systemBrowserCandidates() {
  const env = process.env;
  switch (process.platform) {
    case 'darwin': {
      const roots = ['/Applications', join(homedir(), 'Applications')];
      return [
        ...roots.map((root) => ({
          provider: 'chrome',
          executablePath: join(root, 'Google Chrome.app/Contents/MacOS/Google Chrome'),
        })),
        ...roots.map((root) => ({
          provider: 'msedge',
          executablePath: join(root, 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
        })),
        ...roots.map((root) => ({
          provider: 'system-chromium',
          executablePath: join(root, 'Chromium.app/Contents/MacOS/Chromium'),
        })),
      ];
    }
    case 'win32': {
      const roots = [
        ...new Set([env['LOCALAPPDATA'], env['ProgramFiles'], env['ProgramFiles(x86)']]),
      ].filter((root): root is string => Boolean(root && isAbsolute(root)));
      return [
        ...roots.map((root) => ({
          provider: 'chrome',
          executablePath: join(root, 'Google/Chrome/Application/chrome.exe'),
        })),
        ...roots.map((root) => ({
          provider: 'msedge',
          executablePath: join(root, 'Microsoft/Edge/Application/msedge.exe'),
        })),
        ...roots.map((root) => ({
          provider: 'system-chromium',
          executablePath: join(root, 'Chromium/Application/chrome.exe'),
        })),
      ];
    }
    case 'linux':
      return [
        { provider: 'chrome', executablePath: '/opt/google/chrome/chrome' },
        { provider: 'chrome', executablePath: '/usr/bin/google-chrome' },
        { provider: 'msedge', executablePath: '/opt/microsoft/msedge/msedge' },
        { provider: 'msedge', executablePath: '/usr/bin/microsoft-edge' },
        { provider: 'system-chromium', executablePath: '/usr/bin/chromium' },
        { provider: 'system-chromium', executablePath: '/usr/bin/chromium-browser' },
        { provider: 'system-chromium', executablePath: '/snap/bin/chromium' },
      ];
    default:
      return [];
  }
}

async function isExecutableFile(path: string) {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch (cause) {
    if (
      ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((cause as NodeJS.ErrnoException).code ?? '')
    )
      return false;
    throw cause;
  }
}

/** Static only: never starts a browser or downloads dependencies. */
export const browserPreflight = () => timed('browser-preflight', checkBrowserPreflight);

async function checkBrowserPreflight() {
  const config = browserConfiguration();
  if (
    !['auto', 'headless-shell', 'chrome', 'msedge', 'chromium', 'executable'].includes(
      config.provider,
    )
  )
    throw new RenderFailure('BROWSER_CONFIGURATION_INVALID', 'Unknown DECKUSE_BROWSER_PROVIDER', {
      provider: config.provider,
    });
  if (config.execution === 'denied')
    throw new RenderFailure(
      'BROWSER_HOST_DENIED',
      'Host declares browser execution unavailable. Use a host-approved worker or execution context; Deckuse will not bypass this restriction.',
      { provider: config.provider, stage: 'preflight', retryable: false },
    );
  checkPreviewDependencies();
  let executableStatus = 'unknown';
  if (config.provider === 'executable') {
    const executable = config.executablePath;
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
    installation: installCommand,
  };
}
export async function launchRenderBrowser(
  launch?: BrowserType['launch'],
  timeout?: number,
): Promise<Browser> {
  return (await launchConfiguredBrowser(await browserPreflight(), launch, timeout)).browser;
}

async function launchConfiguredBrowser(
  config: Awaited<ReturnType<typeof browserPreflight>>,
  launch: BrowserType['launch'] | undefined,
  timeout?: number,
) {
  for (const warning of config.cleanupWarnings)
    process.stderr.write(
      `deckuse: ${warning.code} (${String(warning.details['retainedPath'])}): ${warning.message}\n`,
    );
  const key = JSON.stringify({ ...config, cleanupWarnings: undefined });
  const previous = failed.get(key);
  if (previous && process.env['DECKUSE_BROWSER_RETRY'] !== '1') throw previous;
  if (!launch) {
    const chromium = await loadPreviewBrowser();
    launch = chromium.launch.bind(chromium);
  }
  const managed = config.provider === 'auto' || config.provider === 'headless-shell';
  const primary = {
    provider: managed ? 'headless-shell' : config.provider,
    executablePath: config.provider === 'executable' ? config.executablePath : undefined,
  };
  const candidates = config.provider === 'auto' ? systemBrowserCandidates() : [];
  const checkedProviders = new Set([primary.provider]);
  let lastFailure: { provider: string; message: string; missing: boolean } | undefined;
  for (const candidate of [primary, ...candidates]) {
    const { provider } = candidate;
    checkedProviders.add(provider);
    if (candidate !== primary && !(await isExecutableFile(candidate.executablePath ?? '')))
      continue;
    try {
      const browser = await launch({
        headless: true,
        ...(timeout === undefined ? {} : { timeout }),
        ...(candidate.executablePath ? { executablePath: candidate.executablePath } : {}),
        ...(provider !== 'headless-shell' && provider !== 'executable'
          ? { channel: provider === 'system-chromium' ? 'chromium' : provider }
          : {}),
      });
      return { browser, provider };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof Error && cause.name === 'TimeoutError')
        throw new RenderFailure('BROWSER_PROBE_TIMEOUT', cause.message, {
          stage: 'launch',
          provider,
        });
      const missing =
        /Executable doesn't exist|executable.*does not exist|distribution.*not found/i.test(
          message,
        );
      lastFailure = { provider, message, missing };
      if (!missing) break;
    }
  }

  if (!lastFailure) throw new RenderFailure('BROWSER_NOT_FOUND', 'No render browser was selected.');
  const { provider, message, missing } = lastFailure;
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
      ? managed
        ? `No render browser was found. Run \`${installCommand}\` to install the matching Chromium Headless Shell.`
        : `The configured browser (${provider}) was not found. Install it or select another browser.`
      : registration
        ? 'Browser application registration failed. Ask the host for an approved browser execution context; browser selection stopped.'
        : 'Browser was found but failed to launch. Inspect the launch log and host execution context before explicitly retrying; reinstalling is not assumed to fix this.',
    {
      provider,
      stage: 'launch',
      log,
      ...(config.provider === 'auto' ? { checkedProviders: [...checkedProviders] } : {}),
      ...(missing && managed ? { installCommand } : {}),
      ...(message.match(/(?:exitCode|signal)=[^\s]+/g)
        ? { processStatus: message.match(/(?:exitCode|signal)=[^\s]+/g) }
        : {}),
    },
  );
  failed.set(key, failure);
  throw failure;
}
export function renderFailurePayload(cause: unknown) {
  return {
    code: cause instanceof RenderFailure ? cause.code : 'RENDER_FAILED',
    message: cause instanceof Error ? cause.message : String(cause),
    ...(cause instanceof RenderFailure ? { details: cause.details } : {}),
  };
}

/** Playwright owns the temporary profile and cancels launch on timeout. */
export async function probeRenderBrowser(
  launch?: BrowserType['launch'],
  config?: Awaited<ReturnType<typeof browserPreflight>>,
) {
  const { browser, provider } = await launchConfiguredBrowser(
    config ?? (await browserPreflight()),
    launch,
    5000,
  );
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
  return { resolvedProvider: provider };
}
