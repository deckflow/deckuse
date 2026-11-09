import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const generationRunner =
  process.env['DECKUSE_TEST_GENERATION'] ?? resolve('scripts/rebuild-generation.mjs');

it.each([
  ['new', 'empty'],
  ['new', 'false-envelope'],
  ['apply', 'invalid-json'],
  ['apply', 'nonzero'],
  ['validate', 'missing-valid'],
  ['export', 'false-envelope'],
  ['export', 'empty-file'],
])('stops on %s %s and preserves the previous deliverable', async (phase, fault) => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-generation-fault-'));
  const old = join(root, 'presentation.pptx');
  const ops = join(root, 'ops.json');
  const names = join(root, 'names.json');
  const hook = join(root, 'fault.mjs');
  const original = await readFile('assets/default.pptx');
  await Promise.all([
    writeFile(old, original),
    writeFile(ops, '[]'),
    writeFile(names, '["Page"]'),
    writeFile(
      hook,
      `
      import { writeFileSync } from 'node:fs';
      if (process.argv[1]?.endsWith('/dist/bin.js')) {
        const phase = process.argv[2];
        const fault = phase === ${JSON.stringify(phase)} ? ${JSON.stringify(fault)} : '';
        if (phase === 'export') writeFileSync(process.argv[3], '');
        if (fault === 'invalid-json') console.log('{');
        else if (fault !== 'empty') console.log(JSON.stringify({
          ok: fault !== 'false-envelope',
          data: { revision: '2', valid: fault === 'missing-valid' ? undefined : true },
        }));
        process.exit(fault === 'nonzero' ? 1 : 0);
      }
    `,
    ),
  ]);
  const result = spawnSync(process.execPath, [generationRunner, root, ops, names], {
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: `--import=${hook}` },
  });
  expect(result.status).toBe(1);
  const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({ ok: false, state: 'failed', phase });
  expect(report.output).toBeUndefined();
  expect(await readFile(old)).toEqual(original);
  expect(JSON.parse(await readFile(report.report, 'utf8'))).toMatchObject({ phase });
  const next = ['new', 'apply', 'validate', 'export'].indexOf(phase) + 1;
  if (next < 4)
    await expect(
      readFile(join(report.generation, ['new', 'apply', 'validate', 'export'][next] + '.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
});

it('reports a blocked preview while retaining the verified structure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-generation-preview-'));
  const names = join(root, 'names.json');
  await writeFile(names, '["Blank starter","Details"]');
  const result = spawnSync(
    process.execPath,
    [
      generationRunner,
      root,
      resolve('skills/deckuse/examples/create-blank-pptx.json'),
      names,
      '--preview',
    ],
    { encoding: 'utf8', env: { ...process.env, DECKUSE_BROWSER_EXECUTION: 'denied' } },
  );
  expect(result.status).toBe(1);
  const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({
    ok: false,
    state: 'preview-blocked',
    phase: 'preview',
    slides: 2,
    visualReview: 'not-performed',
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect((await readFile(report.output)).length).toBeGreaterThan(0);
}, 20_000);

it.each(['intact', 'empty', 'corrupt'])(
  'classifies an export without CLI output with a %s snapshot',
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-publication-fault-'));
    const names = join(root, 'names.json');
    const hook = join(root, 'export-fault.mjs');
    const previous = join(root, 'presentation.pptx');
    const original = await readFile('assets/default.pptx');
    await writeFile(previous, original);
    await writeFile(names, '["Blank starter","Details"]');
    await writeFile(
      hook,
      `
    import { writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    if (process.argv[1]?.endsWith('/dist/bin.js') && process.argv[2] === 'export') {
      const mode = ${JSON.stringify(mode)};
      const workspace = process.argv[process.argv.indexOf('--workspace') + 1];
      if (mode !== 'intact') writeFileSync(join(workspace, 'package.pptx'), mode === 'empty' ? '' : 'invalid ZIP');
      process.exit(1);
    }
  `,
    );
    const result = spawnSync(
      process.execPath,
      [generationRunner, root, resolve('skills/deckuse/examples/create-blank-pptx.json'), names],
      { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--import=${hook}` } },
    );
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      phase: 'export',
      revision: '2',
      failureKind: 'no-cli-envelope',
      state: mode === 'intact' ? 'recoverable-snapshot' : 'failed',
    });
    if (mode === 'intact')
      expect(report.recoverableSnapshot).toMatchObject({
        revision: '2',
        slides: 2,
        slideNames: ['Blank starter', 'Details'],
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    else expect(report.recoverableSnapshot).toBeUndefined();
    expect(await readFile(previous)).toEqual(original);
  },
  20_000,
);

it('resumes a committed apply after stdout loss without replay and rejects changed inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-resume-'));
  const names = join(root, 'names.json');
  const hook = join(root, 'lose-response.mjs');
  await writeFile(names, '["Blank starter","Details"]');
  await writeFile(
    hook,
    `if (process.argv[1]?.endsWith('/dist/bin.js') && process.argv[2] === 'apply') process.stdout.write = () => true;`,
  );
  const first = spawnSync(
    process.execPath,
    [generationRunner, root, resolve('skills/deckuse/examples/create-blank-pptx.json'), names],
    {
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: `--import=${hook}` },
    },
  );
  expect(first.status).toBe(1);
  const failed = JSON.parse(first.stdout);
  expect(failed).toMatchObject({ phase: 'apply', failureKind: 'no-cli-envelope' });
  const resumed = spawnSync(process.execPath, [generationRunner, '--resume', failed.generation], {
    encoding: 'utf8',
  });
  expect(resumed.status, resumed.stderr + resumed.stdout).toBe(0);
  const result = JSON.parse(resumed.stdout);
  expect(result).toMatchObject({ revision: '2', slides: 2, state: 'structural-only' });
  const { readdir } = await import('node:fs/promises');
  expect(
    (await readdir(failed.generation)).filter((name) => /^apply.*started.json$/.test(name)),
  ).toEqual(['apply.started.json']);
  expect(await readFile(failed.report, 'utf8')).toContain('no-cli-envelope');
  await writeFile(join(failed.generation, 'ops.json'), '[]');
  const changed = spawnSync(process.execPath, [generationRunner, '--resume', failed.generation], {
    encoding: 'utf8',
  });
  expect(changed.status).toBe(1);
  expect(JSON.parse(changed.stdout).error).toContain('inputs changed');
  expect((await readFile(result.output)).length).toBeGreaterThan(0);
}, 30000);

it('times out an uncommitted apply and refuses to guess a replay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-resume-timeout-'));
  const names = join(root, 'names.json'),
    hook = join(root, 'hang.mjs');
  await writeFile(names, '["Blank starter","Details"]');
  await writeFile(
    hook,
    `if (process.argv[1]?.endsWith('/dist/bin.js') && process.argv[2] === 'apply') await new Promise(() => { setInterval(() => {}, 1000); });`,
  );
  const first = spawnSync(
    process.execPath,
    [
      generationRunner,
      root,
      resolve('skills/deckuse/examples/create-blank-pptx.json'),
      names,
      '--timeout-ms',
      '3000',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: `--import=${hook}` },
    },
  );
  const failed = JSON.parse(first.stdout);
  expect(failed).toMatchObject({ phase: 'apply', failureKind: 'timeout' });
  const resumed = spawnSync(process.execPath, [generationRunner, '--resume', failed.generation], {
    encoding: 'utf8',
  });
  expect(resumed.status).toBe(1);
  expect(JSON.parse(resumed.stdout).error).toContain('unknown');
}, 20000);

it('retains exported bytes and avoids repeating a blocked preview in the same context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-resume-preview-'));
  const names = join(root, 'names.json');
  await writeFile(names, '["Blank starter","Details"]');
  const env = { ...process.env, DECKUSE_BROWSER_EXECUTION: 'denied' };
  const first = spawnSync(
    process.execPath,
    [
      generationRunner,
      root,
      resolve('skills/deckuse/examples/create-blank-pptx.json'),
      names,
      '--preview',
    ],
    { encoding: 'utf8', env },
  );
  const failed = JSON.parse(first.stdout);
  expect(failed.state).toBe('preview-blocked');
  const before = await readFile(failed.output);
  const resumed = spawnSync(process.execPath, [generationRunner, '--resume', failed.generation], {
    encoding: 'utf8',
    env,
  });
  expect(resumed.status).toBe(1);
  expect(JSON.parse(resumed.stdout).error).toContain('previously blocked');
  expect(await readFile(failed.output)).toEqual(before);
  const { readdir } = await import('node:fs/promises');
  expect(
    (await readdir(failed.generation)).filter((name) => /^preview.*started.json$/.test(name)),
  ).toHaveLength(1);
}, 30000);

it('refuses an external revision change without replacing the prior artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-resume-external-'));
  const names = join(root, 'names.json');
  await writeFile(names, '["Blank starter","Details"]');
  const first = spawnSync(
    process.execPath,
    [generationRunner, root, resolve('skills/deckuse/examples/create-blank-pptx.json'), names],
    { encoding: 'utf8' },
  );
  expect(first.status).toBe(0);
  const result = JSON.parse(first.stdout);
  const original = await readFile(result.output);
  const patch = join(root, 'patch.json');
  await writeFile(
    patch,
    JSON.stringify([{ type: 'setText', target: 'slide:2/shape:Title', value: 'External edit' }]),
  );
  const edited = spawnSync(
    process.execPath,
    [
      resolve('dist/bin.js'),
      'apply',
      '--workspace',
      result.workspace,
      '--input',
      patch,
      '--request-id',
      'external-edit',
      '--expect-revision',
      '2',
      '--json',
    ],
    { encoding: 'utf8' },
  );
  expect(edited.status, edited.stdout).toBe(0);
  const resumed = spawnSync(process.execPath, [generationRunner, '--resume', result.generation], {
    encoding: 'utf8',
  });
  expect(resumed.status).toBe(1);
  expect(JSON.parse(resumed.stdout).error).toContain('stale');
  expect(await readFile(result.output)).toEqual(original);
}, 30000);
