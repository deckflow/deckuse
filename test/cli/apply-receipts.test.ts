import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const exec = promisify(execFile);
const cli = async (args: string[], preload?: string) => {
  const argv = [
    ...(preload ? ['--import', preload] : []),
    resolve('dist/bin.js'),
    ...args,
    '--json',
  ];
  try {
    const { stdout } = await exec(process.execPath, argv);
    return { code: 0, body: JSON.parse(stdout), stdout };
  } catch (cause) {
    const error = cause as { code: number; stdout: string };
    return {
      code: error.code,
      body: error.stdout ? JSON.parse(error.stdout) : null,
      stdout: error.stdout,
    };
  }
};

it('records one commit for concurrent requests, keeps dry-run pure, and refuses reuse after undo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-receipts-'));
  try {
    const ws = join(root, 'ws');
    const input = join(root, 'input.json');
    const report = join(root, 'report.json');
    await writeFile(
      input,
      JSON.stringify([
        { type: 'addSlide', name: 'Second', layout: 'Blank' },
        {
          type: 'addShape',
          slide: 'Second',
          name: 'Label',
          shapeType: 'text',
          x: '10px',
          y: '10px',
          width: '200px',
          height: '50px',
          text: 'Old',
        },
        { type: 'setText', target: 'slide:2/shape:Label', value: '新文字' },
      ]),
    );
    expect((await cli(['new', ws])).code).toBe(0);
    const tracked = [
      '.deckuse/manifest.json',
      '.deckuse/operations.jsonl',
      'package.pptx',
      'source/ppt/slides/slide1.xml',
    ];
    const snapshot = () =>
      Promise.all(tracked.map((name) => readFile(join(ws, name)).catch(() => null)));
    const before = await snapshot();
    const apply = [
      'apply',
      ws,
      '--input',
      input,
      '--request-id',
      'create',
      '--expect-revision',
      '1',
    ];
    const status = ['status', ws, '--request-id', 'create'];
    expect((await cli([...apply, '--dry-run'])).body.data.dryRun).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect(await readdir(join(ws, 'source/ppt/slides'))).not.toContain('slide2.xml');
    expect((await cli(status)).body.data.state).toBe('unknown');
    const outcomes = await Promise.all([
      cli([...apply, '--summary', '--report', report]),
      cli([...apply, '--summary']),
    ]);
    expect(outcomes.map((result) => result.code)).toEqual([0, 0]);
    expect(outcomes.filter((result) => result.body.data.replayed)).toHaveLength(1);
    expect(outcomes[0]!.stdout.length).toBeLessThan(8192);
    expect(JSON.parse(await readFile(report, 'utf8')).data.results).toHaveLength(3);
    expect((await cli(status)).body.data).toMatchObject({
      state: 'committed',
      current: true,
      revision: '2',
    });
    expect((await cli(['list', 'slides', '--workspace', ws])).body.data.items).toHaveLength(2);
    const original = await readFile(input);
    await writeFile(input, '[{"type":"addSlide","name":"Different","layout":"Blank"}]');
    expect((await cli(apply)).body.error.code).toBe('TRANSACTION_CONFLICT');
    await writeFile(input, original);
    expect((await cli(['undo', '--workspace', ws])).code).toBe(0);
    expect((await cli(status)).body.data.current).toBe(false);
    expect((await cli(apply)).body.error.message).toMatch(/stale/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it.each([false, true])(
  'recovers a receipt across an interrupted commit (committed=%s)',
  async (committed) => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-receipt-interrupt-'));
    try {
      const ws = join(root, 'ws');
      const input = join(root, 'ops.json');
      const preload = join(root, 'interrupt.mjs');
      expect((await cli(['new', ws])).code).toBe(0);
      await writeFile(input, '[{"type":"addSlide","layout":"Blank","name":"New"}]');
      await writeFile(
        preload,
        `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const write = fs.promises.writeFile;
      const remove = fs.promises.rm;
      fs.promises.writeFile = async (path, ...args) => {
        const value = await write(path, ...args);
        if (!${committed} && String(path).includes('/.deckuse/receipts/')) process.exit(19);
        return value;
      };
      fs.promises.rm = async (path, ...args) => {
        if (${committed} && String(path).endsWith('/.deckuse/transaction')) process.exit(19);
        return remove(path, ...args);
      };
      syncBuiltinESMExports();
    `,
      );
      const apply = [
        'apply',
        ws,
        '--input',
        input,
        '--request-id',
        'interrupted',
        '--expect-revision',
        '1',
      ];
      expect((await cli(apply, preload)).code).toBe(19);
      const statusArgs = ['status', ws, '--request-id', 'interrupted'];
      if (committed) {
        const denyCleanup = join(root, 'deny-cleanup.mjs');
        await writeFile(
          denyCleanup,
          `
          import fs from 'node:fs';
          import { syncBuiltinESMExports } from 'node:module';
          const remove = fs.promises.rm;
          fs.promises.rm = async (path, ...args) => {
            if (String(path).endsWith('/.deckuse/transaction')) {
              throw Object.assign(new Error('Injected cleanup denial'), { code: 'EACCES' });
            }
            return remove(path, ...args);
          };
          syncBuiltinESMExports();
        `,
        );
        const deniedCleanupStatus = await cli(statusArgs, denyCleanup);
        expect(deniedCleanupStatus.code).toBe(0);
        expect(deniedCleanupStatus.body.data).toMatchObject({
          state: 'committed',
          current: true,
          revision: '2',
        });
      }
      const status = await cli(statusArgs);
      expect(status.body.data.state).toBe(committed ? 'committed' : 'unknown');
      const retry = await cli(apply);
      expect(retry.body.data.revision).toBe('2');
      expect(Boolean(retry.body.data.replayed)).toBe(committed);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  20_000,
);

it('keeps a successful commit when the receiving side closes stdout', async () => {
  const { spawn } = await import('node:child_process');
  const root = await mkdtemp(join(tmpdir(), 'deckuse-receipt-pipe-'));
  try {
    const ws = join(root, 'ws');
    const input = join(root, 'ops.json');
    expect((await cli(['new', ws])).code).toBe(0);
    await writeFile(input, '[{"type":"addSlide","layout":"Blank","name":"New"}]');
    const apply = ['apply', ws, '--input', input, '--request-id', 'pipe', '--expect-revision', '1'];
    const child = spawn(process.execPath, [resolve('dist/bin.js'), ...apply, '--json']);
    child.stdout.destroy();
    const messages: string[] = [];
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => messages.push(chunk));
    await new Promise<void>((done, reject) => {
      child.once('error', reject);
      child.once('close', () => done());
    });
    expect(messages.join('')).not.toMatch(/Unhandled|ERR_UNHANDLED/);
    expect((await cli(['status', ws, '--request-id', 'pipe'])).body.data).toMatchObject({
      state: 'committed',
      current: true,
      revision: '2',
    });
    expect((await cli(apply)).body.data.replayed).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
