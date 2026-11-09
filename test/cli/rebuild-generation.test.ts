import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

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
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/rebuild-generation.mjs'), root, ops, names],
    { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--import=${hook}` } },
  );
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
      resolve('scripts/rebuild-generation.mjs'),
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
