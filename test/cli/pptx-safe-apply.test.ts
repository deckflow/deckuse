import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const exec = promisify(execFile);
const cliPath = process.env['DECKUSE_TEST_CLI'] ?? resolve('dist/bin.js');

it('preserves five styled blocks, scopes by page, and rejects an unsafe batch atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-safe-replace-'));
  const ws = join(root, 'ws');
  const input = join(root, 'ops.json');
  const cli = async (...args: string[]) => {
    const output = await exec(process.execPath, [cliPath, ...args, '--json']).catch(
      (error: { stdout?: string }) => {
        if (!error.stdout) throw error;
        return { stdout: error.stdout };
      },
    );
    return JSON.parse(output.stdout);
  };
  const apply = async (ops: unknown[], id: string, rev: string) => {
    await writeFile(input, JSON.stringify(ops));
    return cli('apply', ws, '--input', input, '--request-id', id, '--expect-revision', rev);
  };
  try {
    expect((await cli('new', ws, '--blank')).ok).toBe(true);
    const blocks = [
      { runs: [{ text: 'Title', bold: true }, { text: ' plain' }] },
      ...['One', 'Two', 'Three', 'eligible 人群'].map((text) => ({ text })),
    ];
    const shape = (slide: number) => ({
      type: 'addShape',
      slide,
      name: 'Card',
      shapeType: 'text',
      x: '1in',
      y: '1in',
      width: '4in',
      height: '3in',
      blocks,
    });
    expect(
      (
        await apply(
          [
            ...Array.from({ length: 5 }, (_, i) => ({
              type: 'addSlide',
              name: 'Page ' + (i + 2),
              layout: 'Blank',
            })),
            shape(5),
            shape(6),
          ],
          'create',
          '1',
        )
      ).ok,
    ).toBe(true);
    const slides = (await cli('query', ws, 'kind=slide')).data.items;
    const xml = (page: number) => readFile(join(ws, 'source', slides[page - 1].partUri), 'utf8');
    const before = await xml(5);
    const other = await xml(6);
    const replace = { type: 'replaceText', find: 'eligible', replace: '适用' };
    const result = await apply([{ ...replace, selector: 'page=5' }], 'edit', '2');
    expect(result.data).toMatchObject({ revision: '3', affectedSlides: [5] });
    expect(await xml(5)).toBe(before.replace('eligible', '适用'));
    expect(await xml(6)).toBe(other);

    const bad = await apply(
      [
        { ...replace, selector: { page: 6 } },
        { ...replace, selector: { page: 5 }, find: 'Title plain' },
      ],
      'unsafe',
      '3',
    );
    expect(bad.error).toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY',
      message: expect.stringContaining('different formatting'),
    });
    expect(await xml(6)).toBe(other);
    expect((await cli('status', ws)).data.revision).toBe('3');
    for (const selector of ['page=7', 'page=5 typo=Card', 'page=0']) {
      expect((await apply([{ ...replace, selector }], selector, '3')).error.code).toBe(
        'INVALID_COMMAND',
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

it('records and replays no-op receipts without a content transaction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-no-op-'));
  const ws = join(root, 'ws');
  const input = join(root, 'ops.json');
  const cli = async (...args: string[]) => {
    const output = await exec(process.execPath, [cliPath, ...args, '--json'], {
      env: { ...process.env, DECKUSE_CLEANUP_MODE: 'retire' },
    }).catch((error: { stdout?: string }) => {
      if (!error.stdout) throw error;
      return { stdout: error.stdout };
    });
    return JSON.parse(output.stdout);
  };
  const apply = (id: string, revision: string, ...flags: string[]) =>
    cli('apply', ws, '--input', input, '--request-id', id, '--expect-revision', revision, ...flags);
  const write = (...ops: unknown[]) => writeFile(input, JSON.stringify(ops));
  try {
    expect((await cli('new', ws, '--blank')).ok).toBe(true);
    await write({
      type: 'addShape',
      slide: 1,
      shapeType: 'text',
      name: 'Label',
      x: '1in',
      y: '1in',
      width: '2in',
      height: '1in',
      text: 'Original',
    });
    const setup = await apply('setup', '1');
    expect(
      setup.data.cleanupRetirements.map((item: { category: string }) => item.category),
    ).toEqual(expect.arrayContaining(['transaction', 'write.lock']));
    for (const item of setup.data.cleanupRetirements)
      expect(await stat(item.retiredPath)).toBeDefined();
    const paths = [
      '.deckuse/operations.jsonl',
      '.deckuse/manifest.json',
      'package.pptx',
      join('source', (await cli('query', ws, 'kind=slide')).data.items[0].partUri),
    ];
    const snapshot = () => Promise.all(paths.map((path) => readFile(join(ws, path))));
    const gitHead = async () => (await exec('git', ['-C', ws, 'rev-parse', 'HEAD'])).stdout;
    const before = await snapshot();
    const head = await gitHead();
    const op = { type: 'replaceText', find: 'Missing', replace: 'Other' };
    await write(op);
    expect((await apply('noop', '2', '--dry-run')).data).toMatchObject({
      dryRun: true,
      noOp: true,
    });
    expect((await cli('status', ws, '--request-id', 'noop')).data.state).toBe('unknown');
    const results = await Promise.all([apply('noop', '2'), apply('noop', '2')]);
    expect(results.filter((item) => item.data.replayed)).toHaveLength(1);
    for (const { data } of results) {
      expect(data).toMatchObject({
        noOp: true,
        noOpReason: 'no-text-match',
        revision: '2',
        changedParts: [],
        affectedSlides: [],
      });
      expect(
        new Set(data.cleanupRetirements.map((item: { category: string }) => item.category)),
      ).toEqual(new Set(['write.lock']));
    }
    expect((await cli('status', ws, '--request-id', 'noop')).data).toMatchObject({
      state: 'no-op',
      current: true,
    });
    await write({ ...op, find: 'Original', replace: 'Original' });
    expect((await apply('same-text', '2')).data.noOpReason).toBe('identical-replacement');
    expect((await apply('noop', '2')).error.message).toMatch(/different operations/);
    await write({ ...op, find: 'Original' }, { ...op, find: 'Other', replace: 'Original' });
    expect((await apply('undo-within-batch', '2')).data.noOpReason).toBe('unchanged-content');
    expect(await snapshot()).toEqual(before);
    expect(await gitHead()).toBe(head);
    await write({ ...op, find: 'Original' });
    expect((await apply('real-edit', '2')).data.revision).toBe('3');
    await write(op);
    expect((await apply('noop', '2')).error.message).toMatch(/stale/);
    expect((await cli('status', ws, '--request-id', 'noop')).data.current).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
