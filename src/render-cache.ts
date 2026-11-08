import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir, platform, release } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { browserConfiguration } from './render-browser.js';
import { version } from './version.js';
import type { RenderResult } from './render.js';

const require = createRequire(import.meta.url);

async function fileStamp(path: string) {
  const data = await stat(path).catch(() => undefined);
  return [path, data?.size, data?.mtimeMs, data?.ctimeMs];
}

export async function renderEnvironmentKey(binary?: string) {
  const config = browserConfiguration();
  const roots = [
    ...(platform() === 'darwin'
      ? ['/System/Library/Fonts', '/Library/Fonts', join(homedir(), 'Library', 'Fonts')]
      : platform() === 'win32'
        ? [
            join(process.env['WINDIR'] ?? 'C:\\Windows', 'Fonts'),
            join(process.env['LOCALAPPDATA'] ?? homedir(), 'Microsoft', 'Windows', 'Fonts'),
          ]
        : [
            '/usr/share/fonts',
            '/usr/local/share/fonts',
            '/etc/fonts',
            join(homedir(), '.fonts'),
            join(process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local/share'), 'fonts'),
          ]),
  ];
  const fonts = await Promise.all(
    roots.map(async (root) => {
      const files = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
      return Promise.all(
        [
          root,
          ...files
            .filter((item) => !item.isDirectory())
            .map((item) => join(item.parentPath, item.name))
            .sort(),
        ].map(fileStamp),
      );
    }),
  );
  const inputs = [
    binary,
    config.executablePath,
    chromium.executablePath(),
    ...(platform() === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/Info.plist',
          '/Applications/Microsoft Edge.app/Contents/Info.plist',
          '/Applications/Chromium.app/Contents/Info.plist',
        ]
      : platform() === 'linux'
        ? ['/opt/google/chrome/chrome', '/opt/microsoft/msedge/msedge', '/usr/bin/chromium']
        : []),
    process.env['FONTCONFIG_FILE'],
    process.env['DECK2HTML_LICENSE'],
    join(homedir(), '.deckflow', 'deck2html.lic'),
    join(homedir(), '.deckflow', 'deckuse.lic'),
    require.resolve('tailwindcss'),
    require.resolve('echarts/dist/echarts.min.js'),
    require.resolve('@fortawesome/fontawesome-free/css/all.min.css'),
  ];
  return JSON.stringify({
    cacheVersion: 1,
    version,
    platform: platform(),
    release: release(),
    config,
    fonts,
    fontConfigPath: process.env['FONTCONFIG_PATH'],
    language: process.env['LANG'],
    files: await Promise.all(inputs.filter((path): path is string => Boolean(path)).map(fileStamp)),
  });
}

export async function readRenderCache(
  output: string,
  key: string | undefined,
): Promise<RenderResult | undefined> {
  try {
    const cached = JSON.parse(await readFile(output + '.deckuse.json', 'utf8')) as {
      key: string;
      sha: string;
      result: RenderResult;
    };
    if (
      cached.key === key &&
      cached.sha ===
        createHash('sha256')
          .update(await readFile(output))
          .digest('hex')
    )
      return { ...cached.result, output };
  } catch {
    // An incomplete or replaced cache entry is a miss.
  }
  return undefined;
}

export async function writeRenderCache(result: RenderResult, key: string | undefined) {
  const sha = createHash('sha256')
    .update(await readFile(result.output))
    .digest('hex');
  await writeFile(result.output + '.deckuse.json', JSON.stringify({ key, sha, result }));
}
