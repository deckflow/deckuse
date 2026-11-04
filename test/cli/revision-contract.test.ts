import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { revisionAsNumber } from '../../src/core/schema.js';

it('normalizes only canonical, safely comparable workspace counters', () => {
  for (const value of ['1', 1, '0', 0]) expect(revisionAsNumber(value)).toBe(Number(value));
  for (const value of [
    '',
    '01',
    '1.0',
    '-1',
    'opaque',
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    expect(revisionAsNumber(value)).toBeUndefined();
});
it('preserves the protocol projection and raw revisions across CLI operations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-revision-contract-'));
  const ws = join(root, 'ws');
  const cli = (...args: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, [resolve('dist/bin.js'), ...args, '--json'], {
        encoding: 'utf8',
      }),
    );
  const check = (result: { ok: boolean; revision: number; data: { revision: string } }) => {
    expect(result.ok).toBe(true);
    expect(typeof result.revision).toBe('number');
    expect(typeof result.data.revision).toBe('string');
    expect(revisionAsNumber(result.data.revision)).toBe(result.revision);
  };
  check(cli('new', ws));
  check(cli('init', resolve('assets/default.pptx'), join(root, 'imported')));
  check(cli('status', '--workspace', ws));
  check(cli('add', 'slide', '--layout', 'Blank', '--name', 'Example', '--workspace', ws));
  const ops = join(root, 'ops.json');
  await writeFile(
    ops,
    JSON.stringify([
      {
        type: 'addShape',
        slide: 2,
        shapeType: 'text',
        name: 'Title',
        x: '1in',
        y: '1in',
        width: '3in',
        height: '1in',
        text: 'Revision',
      },
    ]),
  );
  check(cli('apply', '--input', ops, '--workspace', ws, '--expect-revision', '2'));
  check(cli('export', join(root, 'out.pptx'), '--workspace', ws));
  const history = cli('history', '--workspace', ws);
  expect(history.revision).toBeUndefined();
  expect(history.data.records.length).toBeGreaterThan(0);
  for (const record of history.data.records) expect(typeof record.revision).toBe('string');
  check(cli('undo', '--workspace', ws));
}, 30_000);
