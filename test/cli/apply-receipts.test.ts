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
    process.env['DECKUSE_TEST_CLI'] ?? resolve('dist/bin.js'),
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
    const other = join(root, 'other.json');
    await writeFile(other, '[{"type":"addSlide","layout":"Blank","name":"Third"}]');
    expect((await cli(['apply', ws, '--input', other, '--expect-revision', '2'])).code).toBe(0);
    expect((await cli(apply)).body.data).toMatchObject({ replayed: true, revision: '2' });
    expect((await cli(['status', ws])).body.data.revision).toBe('3');
    expect((await cli(['undo', '--workspace', ws, '--steps', '2'])).code).toBe(0);
    expect((await cli(status)).body.data).toMatchObject({ state: 'reverted', current: false });
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

it('records a known rejection and preserves the workspace after ambiguous slide names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-receipt-rejected-'));
  const ws = join(root, 'ws');
  const input = join(root, 'ops.json');
  expect((await cli(['new', ws, '--blank'])).code).toBe(0);
  expect((await cli(['new', ws, '--blank'])).body.error.code).toBe('WORKSPACE_NOT_EMPTY');
  await writeFile(
    input,
    JSON.stringify([
      { type: 'addSlide', layout: 'Blank', name: 'Same' },
      { type: 'addSlide', layout: 'Blank', name: 'Same' },
      { type: 'addShape', slide: 'Same', shapeType: 'text', text: 'Do not write' },
    ]),
  );
  const apply = [
    'apply',
    ws,
    '--input',
    input,
    '--request-id',
    'rejected',
    '--expect-revision',
    '1',
  ];
  expect((await cli(apply)).body.error.message).toMatch(/ambiguous/);
  expect((await cli(['status', ws, '--request-id', 'rejected'])).body.data).toMatchObject({
    state: 'not-committed',
    revision: '1',
  });
  expect((await cli(['list', 'slides', '--workspace', ws])).body.data.items).toHaveLength(1);
  expect((await cli(apply)).body.error.message).toMatch(/ambiguous/);
}, 30_000);

it('restores the current revision when undo fails after changing Git HEAD', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-undo-fault-'));
  const ws = join(root, 'ws');
  const input = join(root, 'ops.json');
  const preload = join(root, 'undo-fault.mjs');
  expect((await cli(['new', ws, '--blank'])).code).toBe(0);
  await writeFile(input, '[{"type":"addSlide","layout":"Blank","name":"Retain"}]');
  expect((await cli(['apply', ws, '--input', input, '--request-id', 'retain'])).code).toBe(0);
  const original = await readFile(join(ws, 'package.pptx'));
  await writeFile(join(ws, 'user-note.txt'), 'Keep this note');
  await writeFile(
    preload,
    `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const write = fs.promises.writeFile;
    fs.promises.writeFile = async (path, ...args) => {
      if (/package\\.pptx\\..+\\.tmp$/.test(String(path))) throw new Error('Injected undo packaging error');
      return write(path, ...args);
    };
    syncBuiltinESMExports();
  `,
  );
  expect((await cli(['undo', '--workspace', ws], preload)).body.error.message).toContain(
    'Injected undo packaging error',
  );
  expect((await cli(['status', ws])).body.data.revision).toBe('2');
  expect((await cli(['list', 'slides', '--workspace', ws])).body.data.items).toHaveLength(2);
  expect(await readFile(join(ws, 'package.pptx'))).toEqual(original);
  expect(await readFile(join(ws, 'user-note.txt'), 'utf8')).toBe('Keep this note');
  expect((await cli(['undo', '--workspace', ws])).body.data.revision).toBe('1');
  expect(await readFile(join(ws, 'user-note.txt'), 'utf8')).toBe('Keep this note');
}, 30_000);

it.each(['lock', 'journal', 'retirement'])(
  'preserves a committed write when %s cleanup is denied',
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-postcommit-cleanup-'));
    const ws = join(root, 'ws');
    const input = resolve('skills/deckuse/examples/create-blank-pptx.json');
    const preload = join(root, 'deny.mjs');
    expect((await cli(['new', ws, '--blank'])).code).toBe(0);
    await writeFile(
      preload,
      `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const mode = ${JSON.stringify(mode)};
    if (mode === 'retirement') process.env.DECKUSE_CLEANUP_MODE = 'retire';
    const rm = fs.promises.rm, rename = fs.promises.rename;
    function blocked(path) {
      const name = String(path).split(/[\\\\/]/).at(-1);
      if (name !== 'write.lock' && name !== 'transaction') return false;
      const root = String(path).slice(0, -name.length);
      const revision = JSON.parse(fs.readFileSync(root + 'manifest.json', 'utf8')).revision;
      return revision === '2' && (mode === 'retirement' || (mode === 'lock' ? name === 'write.lock' : name === 'transaction'));
    }
    const deny = () => { throw Object.assign(new Error('Injected cleanup denial'), { code: 'EACCES' }); };
    fs.promises.rm = async (path, ...args) => { if (blocked(path)) deny(); return rm(path, ...args); };
    fs.promises.rename = async (path, ...args) => { if (mode === 'retirement' && blocked(path)) deny(); return rename(path, ...args); };
    syncBuiltinESMExports();
  `,
    );
    const args = [
      'apply',
      ws,
      '--input',
      input,
      '--request-id',
      'create',
      '--expect-revision',
      '1',
      '--summary',
    ];
    const first = await cli(args, preload);
    expect(first.code).toBe(0);
    expect(first.body.data).toMatchObject({ revision: '2', cleanupWarnings: expect.any(Array) });
    expect(
      first.body.data.cleanupWarnings.map((warning: { code: string }) => warning.code),
    ).toContain(mode === 'journal' ? 'TRANSACTION_CLEANUP_FAILED' : 'WRITE_LOCK_CLEANUP_FAILED');
    expect((await cli(args)).body.data).toMatchObject({ revision: '2', replayed: true });
    expect(
      (await cli(['validate', '--workspace', ws, '--expect-slides', '2', '--expect-revision', '2']))
        .code,
    ).toBe(0);
    expect(
      (await cli(['validate', '--workspace', ws, '--expect-slides', '1'])).body.error.details,
    ).toMatchObject({ expectedSlides: 1, observedSlides: 2 });
  },
  30_000,
);
