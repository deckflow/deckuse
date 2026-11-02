#!/usr/bin/env node
import { chromium } from 'playwright-core';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { startMonitor, runCommand } from '../dist/index.js';
const workspace = join(await mkdtemp(join(tmpdir(), 'deckuse-monitor-browser-')), 'ws');
const initialized = await runCommand({
  version: '2.0',
  type: 'init',
  workspaceId: workspace,
  format: 'pptx',
  source: resolve('assets/default.pptx'),
});
if (!initialized.ok) throw new Error(JSON.stringify(initialized));
let fail = false,
  trigger;
const monitor = await startMonitor(workspace, {
  port: 0,
  dependencies: {
    debounceMs: 1,
    watch: (_path, listener) => {
      trigger = listener;
      const watcher = new EventEmitter();
      watcher.close = () => {};
      return watcher;
    },
    convert: async (_input, options) => {
      if (fail)
        return {
          exitCode: 1,
          stderr: 'deliberate QA conversion failure',
          stdout: '',
          indexHtmlPath: '',
        };
      await writeFile(
        join(options.output, 'index.html'),
        '<html><body>Known preview</body></html>',
      );
      return {
        exitCode: 0,
        stderr: '',
        stdout: '',
        indexHtmlPath: join(options.output, 'index.html'),
      };
    },
  },
});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(monitor.url);
  await page.waitForFunction(() => document.querySelector('iframe').src.includes('/render/'));
  await page.waitForFunction(() =>
    document.querySelector('#quality').textContent.includes('ready'),
  );
  fail = true;
  await writeFile(
    join(workspace, '.deckuse/operations.jsonl'),
    JSON.stringify({ revision: '2', slides: [1], operation: { type: 'setText' } }) + '\n',
  );
  trigger();
  await page.waitForFunction(() =>
    document.querySelector('#status').textContent.includes('displayed image is stale'),
  );
  const evidence = await page.evaluate(() => ({
    quality: document.querySelector('#quality').textContent,
    status: document.querySelector('#status').textContent,
    frame: document.querySelector('iframe').src,
    visible: !document.querySelector('#status').hidden,
  }));
  if (
    !evidence.visible ||
    !evidence.status.includes('deliberate QA conversion failure') ||
    errors.length
  )
    throw new Error(JSON.stringify({ evidence, errors }));
  const output = resolve('.tmp/visual-baseline');
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, 'monitor-error.png') });
  await writeFile(
    join(output, 'monitor-ui.json'),
    JSON.stringify({ passed: true, ...evidence, errors }, null, 2) + '\n',
  );
  console.log('monitor browser QA: passed (ready → pending → stale error)');
} finally {
  await browser.close();
  await monitor.close();
}
