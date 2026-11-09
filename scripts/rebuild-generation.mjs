#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { OpcArchive } from '../dist/opc/index.js';
import { buildIndex } from '../dist/pptx/indexer.js';
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
let artifact;
const runId = process.env.DECKUSE_RUN_ID ?? requestId;
const reportPath = join(generation, 'run.json');
async function cli(args) {
  const startedAt = Date.now();
  const argv = [binary, ...args, '--json'];
  const commandId = phase;
  const result = spawnSync(process.execPath, argv, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      DECKUSE_CLEANUP_MODE: 'retire',
      DECKUSE_RUN_ID: runId,
      DECKUSE_COMMAND_ID: commandId,
    },
  });
  const durationMs = Date.now() - startedAt;
  await writeFile(
    join(generation, phase + '.process.json'),
    JSON.stringify({
      argv,
      runId,
      commandId,
      startedAt,
      durationMs,
      status: result.status,
      signal: result.signal,
      error: result.error?.message,
    }),
    { flag: 'wx' },
  );
  await writeFile(join(generation, phase + '.stderr.txt'), result.stderr ?? '', { flag: 'wx' });
  await writeFile(join(generation, phase + '.json'), result.stdout ?? '', { flag: 'wx' });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (!result.stdout?.trim()) throw new Error(phase + ' returned empty stdout');
  const envelope = JSON.parse(result.stdout);
  if (
    result.status !== 0 ||
    envelope?.ok !== true ||
    (['validate', 'export'].includes(phase) && envelope.data?.valid !== true)
  )
    throw new Error(envelope?.error?.message ?? phase + ' failed');
  return envelope.data;
}
async function report(result) {
  const data = {
    runId,
    generation,
    workspace,
    phase,
    revision,
    visualReview: 'not-performed',
    ...result,
  };
  await writeFile(reportPath, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...data, report: reportPath }));
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
  const exported = await cli([
    'export',
    output,
    '--workspace',
    workspace,
    '--revision',
    revision,
    '--from-package',
  ]);
  if (exported.revision !== revision) throw new Error('Export revision does not match validation');
  const bytes = await readFile(output);
  if (!bytes.length) throw new Error('Export is empty');
  const archive = await OpcArchive.open(bytes);
  const names = buildIndex(archive, workspace, revision)
    .elements.filter((item) => item.kind === 'slide')
    .map((item) => item.name);
  if (names.length !== expected.length || expected.some((name, i) => name !== names[i]))
    throw new Error('Export slide inventory does not match the expected order');
  artifact = {
    output,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    slides: names.length,
  };
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
      result.inputSha256 !== artifact.sha256 ||
      result.results.length !== expected.length ||
      result.results.some(
        (page, i) => !page.ok || page.page !== i + 1 || page.result?.revision !== revision,
      )
    )
      throw new Error('Preview does not match the replacement generation');
  }
  await report({
    ok: true,
    ...artifact,
    state: preview ? 'preview-ready' : 'structural-only',
    ...(preview ? { previewInventory: join(generation, 'preview.json') } : {}),
  });
} catch (cause) {
  process.exitCode = 1;
  await report({
    ok: false,
    ...artifact,
    state: artifact && phase === 'preview' ? 'preview-blocked' : 'failed',
    error: cause instanceof Error ? cause.message : String(cause),
  });
}
