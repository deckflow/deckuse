import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-pptx-regression-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

function cli(args: string[], options: { preload?: string; env?: NodeJS.ProcessEnv } = {}) {
  const result = spawnSync(
    process.execPath,
    [
      ...(options.preload ? ['--import', options.preload] : []),
      resolve('dist/bin.js'),
      ...args,
      '--json',
    ],
    { encoding: 'utf8', env: { ...process.env, ...options.env }, maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  return { status: result.status, envelope: JSON.parse(result.stdout) };
}

it('exports one full report and compact counts, then applies the reported targets', async () => {
  const root = await fixture();
  const workspace = join(root, 'workspace');
  expect(cli(['new', workspace, '--blank']).status).toBe(0);
  const build = join(root, 'build.json');
  await writeFile(
    build,
    JSON.stringify([
      ...Array.from({ length: 24 }, (_, i) => ({
        type: 'addShape',
        slide: 1,
        shapeType: 'rect',
        name: 'Outside ' + i,
        x: '110%',
        y: '20%',
        width: '30px',
        height: '30px',
      })),
      {
        type: 'addShape',
        slide: 1,
        shapeType: 'text',
        name: 'Overflow',
        fill: { color: 'EEEEEE' },
        x: '10%',
        y: '10%',
        width: '300px',
        height: '15px',
        blocks: [{ text: 'Large text', fontSize: 32 }],
      },
      {
        type: 'addShape',
        slide: 1,
        shapeType: 'text',
        name: 'Unrelated',
        x: '60%',
        y: '70%',
        width: '200px',
        height: '100px',
        text: 'Preserved content',
      },
    ]),
  );
  expect(cli(['apply', '--workspace', workspace, '--input', build]).status).toBe(0);
  const output = join(root, 'initial.pptx'),
    report = join(root, 'report.json');
  const exported = cli(['export', output, '--workspace', workspace, '--report', report]);
  expect(exported.status).toBe(0);
  expect(exported.envelope.data).toMatchObject({
    output,
    valid: true,
    revision: '2',
    reportPath: report,
    diagnosticCounts: { OBJECT_OUT_OF_BOUNDS: 24, TEXT_OVERFLOW_SUSPECTED: 1 },
  });
  const full = JSON.parse(await readFile(report, 'utf8'));
  expect(full.data).toMatchObject({ output, revision: '2', valid: true });
  const diagnostics = full.data.visual.diagnostics as {
    code: string;
    details: { target: string };
  }[];
  const overflow = diagnostics.find((d) => d.code === 'TEXT_OVERFLOW_SUSPECTED');
  expect(overflow).toBeDefined();
  const corrected = join(root, 'corrected.json');
  await writeFile(
    corrected,
    JSON.stringify([
      {
        type: 'setProperties',
        target: overflow?.details.target,
        properties: { insets: { top: '4px', bottom: '4px' } },
      },
      { type: 'xfrmSet', target: overflow?.details.target, height: '130px' },
      ...diagnostics
        .filter((d) => d.code === 'OBJECT_OUT_OF_BOUNDS')
        .map((d) => ({
          type: 'xfrmSet',
          target: d.details.target,
          x: '30px',
          y: '250px',
        })),
    ]),
  );
  expect(
    cli(['apply', '--workspace', workspace, '--input', corrected, '--expect-revision', '2']).status,
  ).toBe(0);
  const after = cli(['export', join(root, 'updated.pptx'), '--workspace', workspace]);
  expect(after.status).toBe(0);
  const codes = after.envelope.data.visual.diagnostics.map((d: { code: string }) => d.code);
  expect(codes).not.toContain('OBJECT_OUT_OF_BOUNDS');
  expect(codes).not.toContain('TEXT_OVERFLOW_SUSPECTED');
  expect(
    JSON.stringify(cli(['list', 'shapes', '--slide', '1', '--workspace', workspace]).envelope),
  ).toContain('Preserved content');
}, 30_000);

it('recovers the validated invocation without guessing or overwriting', async () => {
  const root = await fixture();
  const workspace = join(root, 'workspace');
  expect(cli(['new', workspace]).status).toBe(0);
  const destination = join(root, 'blocked.pptx'),
    report = join(root, 'report.json');
  await mkdir(destination);
  const failed = cli(['export', destination, '--workspace', workspace, '--report', report]);
  expect(failed.envelope.data).toMatchObject({
    state: 'validated-staging',
    revision: '1',
    valid: true,
  });
  const stage = failed.envelope.error.details.stagingPath as string;
  const recovered = join(root, 'recovered.pptx');
  await writeFile(join(root, 'unrelated.tmp'), await readFile(stage));
  expect(cli(['export', recovered, '--recover-report', report]).status).toBe(0);
  expect(await readFile(recovered)).toEqual(await readFile(stage));
  expect(cli(['export', recovered, '--recover-report', report]).status).not.toBe(0);
  await writeFile(stage, 'corrupt');
  expect(cli(['export', join(root, 'corrupt.pptx'), '--recover-report', report]).status).not.toBe(
    0,
  );
}, 30_000);

it('retains committed init and export outcomes under cleanup denial', async () => {
  const root = await fixture();
  const preload = join(root, 'fault.mjs');
  await writeFile(
    preload,
    `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const rm = fs.rm, write = fs.writeFile;
    fs.rm = async (path, ...args) => {
      if (/committed[\\\\/]\\.deckuse-init\\.lock$|partial[\\\\/]source$|cleanup\\.pptx\\..+\\.tmp$/.test(String(path)))
        throw new Error('Injected cleanup denial');
      return rm(path, ...args);
    };
    fs.writeFile = async (path, ...args) => {
      if (/partial[\\\\/]package\\.pptx\\..+\\.tmp$/.test(String(path))) throw new Error('Injected init interruption');
      return write(path, ...args);
    };
    syncBuiltinESMExports();
  `,
  );
  const committed = join(root, 'committed');
  expect(cli(['new', committed], { preload }).envelope.data).toMatchObject({
    initializationState: 'committed-with-cleanup-warning',
    diagnostics: [expect.objectContaining({ code: 'INIT_CLEANUP_FAILED' })],
  });
  expect(cli(['status', '--workspace', committed]).envelope.data).toMatchObject({
    initializationState: 'committed-with-cleanup-warning',
    valid: true,
  });
  expect(
    cli(['export', join(root, 'cleanup.pptx'), '--workspace', committed], { preload }).envelope
      .data,
  ).toMatchObject({
    state: 'committed',
    warnings: [expect.stringContaining('Injected cleanup denial')],
  });
  const partial = join(root, 'partial');
  expect(cli(['new', partial], { preload }).status).not.toBe(0);
  expect(cli(['status', '--workspace', partial]).envelope.error).toMatchObject({
    code: 'RECOVERY_REQUIRED',
    details: { state: 'initialization-incomplete' },
  });
  expect(cli(['new', partial]).status).not.toBe(0);
  expect(await readFile(join(partial, '.deckuse-init.lock'), 'utf8')).toBe('');
}, 30_000);

it('stops batch preview at shared converter extraction failure while export works', async () => {
  if (process.platform === 'win32') return;
  const root = await fixture();
  const workspace = join(root, 'workspace');
  const binary = join(root, 'denied-converter');
  await writeFile(
    binary,
    '#!/bin/sh\necho "Failed to extract bundle: Permission denied" >&2\nexit 1\n',
  );
  await chmod(binary, 0o755);
  const options = { env: { DECKUSE_DECK2HTML_BINARY: binary } };
  expect(cli(['new', workspace]).status).toBe(0);
  const render = cli(['render', '--all', '--workspace', workspace], options);
  expect(render.envelope.error).toMatchObject({
    code: 'RENDER_CONVERTER_EXTRACTION_FAILED',
    details: { retryable: false },
  });
  expect(
    cli(['export', join(root, 'out.pptx'), '--workspace', workspace], options).envelope.data.valid,
  ).toBe(true);
}, 30_000);

it('keeps a named slide destination when an earlier insertion shifts its index', async () => {
  const root = await fixture();
  const workspace = join(root, 'workspace');
  const ops = join(root, 'ops.json');
  expect(cli(['new', workspace, '--blank']).status).toBe(0);
  await writeFile(
    ops,
    JSON.stringify([
      { type: 'addSlide', layout: 'Blank', name: 'Details' },
      { type: 'addSlide', layout: 'Blank', name: 'Inserted', after: 1 },
      {
        type: 'addShape',
        slide: 'Details',
        shapeType: 'text',
        name: 'Title',
        text: 'Still on Details',
      },
    ]),
  );
  expect(cli(['apply', '--workspace', workspace, '--input', ops]).status).toBe(0);
  expect(
    JSON.stringify(cli(['list', 'shapes', '--slide', '3', '--workspace', workspace]).envelope),
  ).toContain('Still on Details');
  expect(
    JSON.stringify(cli(['list', 'shapes', '--slide', '2', '--workspace', workspace]).envelope),
  ).not.toContain('Still on Details');
}, 30_000);
