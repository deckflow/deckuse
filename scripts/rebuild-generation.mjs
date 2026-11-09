#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [root, operations, names, preview] = process.argv.slice(2);
if (
  !root ||
  !operations ||
  !names ||
  (preview && preview !== '--preview') ||
  process.argv.length > 6
) {
  console.error(
    'Usage: node rebuild-generation.mjs <existing-output-root> <ops.json> <expected-slide-names.json> [--preview]',
  );
  process.exit(2);
}
const expected = JSON.parse(await readFile(names, 'utf8'));
if (
  !Array.isArray(expected) ||
  !expected.length ||
  expected.some((name) => typeof name !== 'string' || !name) ||
  new Set(expected).size !== expected.length
)
  throw new Error('Expected a nonempty JSON array of unique slide names');

const generation = await mkdtemp(join(resolve(root), 'deckuse-generation-'));
const workspace = join(generation, 'workspace');
const output = join(generation, 'presentation.pptx');
const requestId = randomUUID();
const binary = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
await writeFile(join(generation, 'ops.json'), await readFile(operations), { flag: 'wx' });
await writeFile(join(generation, 'expected-slide-names.json'), JSON.stringify(expected), {
  flag: 'wx',
});
let phase = 'new';
let revision;
let exported = false;
async function cli(args) {
  const result = spawnSync(process.execPath, [binary, ...args, '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, DECKUSE_CLEANUP_MODE: 'retire' },
  });
  if (result.stderr) process.stderr.write(result.stderr);
  await writeFile(join(generation, phase + '.json'), result.stdout ?? '', { flag: 'wx' });
  if (result.error) throw result.error;
  const envelope = JSON.parse(result.stdout);
  if (result.status !== 0 || !envelope.ok || envelope.data?.valid === false)
    throw new Error(envelope.error?.message ?? phase + ' failed');
  return envelope.data;
}
try {
  await cli(['new', workspace, '--blank']);
  phase = 'apply';
  await writeFile(
    join(generation, 'request.json'),
    JSON.stringify({ requestId, expectedRevision: '1' }),
    { flag: 'wx' },
  );
  const applied = await cli([
    'apply',
    workspace,
    '--input',
    join(generation, 'ops.json'),
    '--request-id',
    requestId,
    '--expect-revision',
    '1',
    '--summary',
  ]);
  revision = applied.revision;
  if (revision !== '2') throw new Error('Fresh generation expected revision 2');
  phase = 'validate';
  await cli([
    'validate',
    '--workspace',
    workspace,
    '--expect-revision',
    revision,
    '--expect-slides',
    String(expected.length),
    '--expect-slide-names',
    join(generation, 'expected-slide-names.json'),
  ]);
  phase = 'export';
  await cli(['export', output, '--workspace', workspace, '--revision', revision, '--from-package']);
  exported = true;
  if (preview) {
    phase = 'preview';
    const result = await cli([
      'render',
      '--all',
      '--workspace',
      workspace,
      '--output-dir',
      join(generation, 'preview'),
    ]);
    if (
      result.revision !== revision ||
      result.results.length !== expected.length ||
      result.results.some(
        (page, i) => !page.ok || page.page !== i + 1 || page.result?.revision !== revision,
      )
    )
      throw new Error('Preview does not match the replacement generation');
  }
  console.log(
    JSON.stringify({
      ok: true,
      generation,
      workspace,
      output,
      revision,
      slides: expected.length,
      ...(preview ? { previewInventory: join(generation, 'preview.json') } : {}),
    }),
  );
} catch (cause) {
  console.log(
    JSON.stringify({
      ok: false,
      generation,
      workspace,
      phase,
      revision,
      ...(exported ? { output, state: 'structural-only' } : {}),
      error: cause instanceof Error ? cause.message : String(cause),
    }),
  );
  process.exitCode = 1;
}
