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
