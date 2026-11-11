import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { checkTextAssertions } from '../../src/text-assertions.js';
import { writeApplyReport } from '../../src/apply-report.js';

const cli = (...args: string[]) => {
  const run = spawnSync(process.execPath, [resolve('dist/bin.js'), ...args, '--json'], {
    encoding: 'utf8',
  });
  return { code: run.status, body: JSON.parse(run.stdout) };
};

it('retains first-attempt cleanup warnings on report replay without changing the report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-report-evidence-'));
  const path = join(root, 'report.json');
  const command = { type: 'batch', workspaceId: root, requestId: 'one', commands: [] };
  const data = { revision: '2', requestId: 'one', results: [] };
  const warnings = ['Committed, but transaction cleanup was denied'];
  await writeApplyReport(path, { ok: true, data, warnings }, command);
  const original = await readFile(path);
  expect(
    await writeApplyReport(
      path,
      { ok: true, data: { ...data, replayed: true }, warnings: [] },
      command,
    ),
  ).toEqual({ status: 'reused', warnings });
  expect(await readFile(path)).toEqual(original);
  await expect(
    writeApplyReport(
      path,
      { ok: true, data: { ...data, replayed: true } },
      { ...command, workspaceId: root + '-other' },
    ),
  ).rejects.toThrow('different work');
});

it('reuses the same report without a new commit, preserves unrelated reports and verifies all replacements', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-workflow-'));
  const ws = join(root, 'ws'),
    input = join(root, 'ops.json'),
    report = join(root, 'report.json');
  expect(cli('new', ws, '--blank').code).toBe(0);
  await writeFile(
    input,
    JSON.stringify([
      {
        type: 'addShape',
        slide: 1,
        shapeType: 'text',
        name: 'Title',
        text: 'Old title',
        x: '1in',
        y: '1in',
        width: '5in',
        height: '1in',
      },
      { type: 'replaceText', find: 'Old title', replace: 'Final title' },
    ]),
  );
  const args = [
    'apply',
    ws,
    '--input',
    input,
    '--request-id',
    'build',
    '--expect-revision',
    '1',
    '--report',
    report,
    '--summary',
  ];
  const first = cli(...args);
  expect(first.body.data).toMatchObject({
    mutationState: 'committed',
    reportStatus: 'written',
    matchSummary: { operationCount: 1, changedTargets: 1, zeroMatchOperations: 0 },
  });
  const bytes = await readFile(report);
  const replay = cli(...args);
  expect(replay.body.data).toMatchObject({ replayed: true, reportStatus: 'reused' });
  expect(replay.body.data.reportFailed).toBeUndefined();
  expect(await readFile(report)).toEqual(bytes);
  expect(
    (await readFile(join(ws, '.deckuse/operations.jsonl'), 'utf8')).trim().split('\n'),
  ).toHaveLength(1);

  const unrelated = join(root, 'unrelated.json');
  await writeFile(unrelated, '{"preserve":true}');
  const conflict = cli(...args.map((arg) => (arg === report ? unrelated : arg)));
  expect(conflict.body.data).toMatchObject({
    mutationState: 'committed',
    replayed: true,
    reportStatus: 'failed',
    reportFailed: true,
  });
  expect(await readFile(unrelated, 'utf8')).toBe('{"preserve":true}');
  const altered = JSON.parse(bytes.toString());
  altered.data.results[0].changed = false;
  await writeFile(unrelated, JSON.stringify(altered));
  expect(cli(...args.map((arg) => (arg === report ? unrelated : arg))).body.data.reportFailed).toBe(
    true,
  );

  const assertions = join(root, 'assertions.json');
  await writeFile(
    assertions,
    JSON.stringify([
      { text: 'Final title', count: 1, slide: 1 },
      { text: 'Old title', count: 0 },
    ]),
  );
  const validation = [
    'validate',
    ws,
    '--expect-revision',
    '2',
    '--assert-text',
    assertions,
    '--summary',
  ];
  expect(cli(...validation).body.data).toMatchObject({
    valid: true,
    textAssertions: [
      { actual: 1, valid: true },
      { actual: 0, valid: true },
    ],
  });
  await writeFile(assertions, '[{"text":"Final title","count":0}]');
  expect(cli(...validation)).toMatchObject({
    code: 1,
    body: { ok: false, data: { valid: false } },
  });
  await writeFile(assertions, '[{"text":"Final title","counts":1}]');
  expect(cli(...validation).code).toBe(2);
  expect(cli('status', ws).body.data.revision).toBe('2');
}, 30000);

it('returns changed targets for a standalone replacement and a strict dereferenced field contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-match-summary-'));
  const ws = join(root, 'ws'),
    input = join(root, 'ops.json');
  cli('new', ws, '--blank');
  await writeFile(
    input,
    JSON.stringify([
      {
        type: 'addShape',
        slide: 1,
        shapeType: 'text',
        name: 'Label',
        text: 'Before',
        x: '1in',
        y: '1in',
        width: '3in',
        height: '1in',
      },
    ]),
  );
  cli('apply', ws, '--input', input, '--request-id', 'create');
  await writeFile(
    input,
    '[{"type":"replaceText","find":"Before","replace":"After"},{"type":"replaceText","find":"absent","replace":"unused"}]',
  );
  const patched = cli('apply', ws, '--input', input, '--request-id', 'patch', '--summary');
  expect(patched.body.data.changedTargets).toEqual(['slide:1/shape:2']);
  expect(patched.body.data.matchSummary).toMatchObject({
    zeroMatchOperations: 1,
    changedTargets: 1,
  });
  const field = cli('schema', '--type', 'addShape', '--field', 'blocks');
  expect(field.body.data.schema.items.properties).toHaveProperty('fontSize');
  expect(JSON.stringify(field.body.data.schema)).not.toContain('$ref');
  expect(cli('schema', '--type', 'addShape', '--field', 'invented').code).toBe(2);
  expect(cli('schema', '--list', '--field', 'blocks').code).toBe(2);
}, 20000);

it('never treats missing inspection or a nonexistent page as zero matches', () => {
  expect(() => checkTextAssertions([{ text: 'x', count: 0 }], {})).toThrow();
  expect(
    checkTextAssertions([{ text: 'x', count: 0, slide: 2 }], { slides: [{ page: 1, text: [] }] })[0]
      ?.valid,
  ).toBe(false);
  expect(
    checkTextAssertions([{ text: 'x', count: 1 }], {
      slides: [{ page: 1, text: [{ target: 't', text: 'xx' }] }],
    })[0]?.valid,
  ).toBe(true);
});

it('rebuilds ordered patches and refuses resume after recipe source changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-recipe-'));
  const base = join(root, 'base.json'),
    patch1 = join(root, 'patch1.json'),
    patch2 = join(root, 'patch2.json');
  const names = join(root, 'names.json'),
    assertions = join(root, 'assertions.json');
  await writeFile(
    base,
    JSON.stringify([
      {
        type: 'addShape',
        slide: 1,
        shapeType: 'text',
        name: 'Title',
        text: 'Draft',
        x: '1in',
        y: '1in',
        width: '4in',
        height: '1in',
      },
    ]),
  );
  await writeFile(patch1, '[{"type":"replaceText","find":"Draft","replace":"Reviewed"}]');
  await writeFile(patch2, '[{"type":"replaceText","find":"Reviewed","replace":"Final"}]');
  await writeFile(names, '["Blank starter"]');
  await writeFile(assertions, '[{"text":"Final","count":1},{"text":"Draft","count":0}]');
  const runner = resolve('scripts/rebuild-generation.mjs');
  const invoke = (...args: string[]) =>
    spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8' });
  const run = invoke(
    root,
    base,
    names,
    '--patch',
    patch1,
    '--patch',
    patch2,
    '--assert-text',
    assertions,
  );
  expect(run.status, run.stderr + run.stdout).toBe(0);
  const report = JSON.parse(run.stdout);
  expect(report.revision).toBe('2');
  const compiled = JSON.parse(await readFile(join(report.generation, 'ops.json'), 'utf8'));
  expect(compiled).toHaveLength(3);
  expect(invoke('--resume', report.generation).status).toBe(0);
  await writeFile(join(report.generation, 'recipe-1.json'), '[]');
  const changed = invoke('--resume', report.generation);
  expect(changed.status).toBe(1);
  expect(JSON.parse(changed.stdout).error).toContain('recipe inputs changed');
}, 30000);
