#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { OpcArchive } from '../dist/opc/index.js';
import { buildIndex } from '../dist/pptx/indexer.js';
import { commandSchema } from '../dist/core/schema.js';
import { operationDigest } from '../dist/workspace/receipts.js';
import { withWriteLock } from '../dist/workspace/lock.js';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const option = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) throw Error(`Missing ${name} value`);
  args.splice(i, 2);
  return value;
};
const patchInputs = [];
while (args.includes('--patch')) patchInputs.push(option('--patch'));
const assertionsInput = option('--assert-text');
const resume = option('--resume');
const requestedPreview = flag('--preview');
const retryPreview = flag('--retry-preview');
const timeoutValue = option('--timeout-ms');
const previewTimeoutValue = option('--preview-timeout-ms');
const duration = (value, fallback) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 3600000)
    throw Error('Timeout must be 1..3600000 ms');
  return n;
};
if (
  (resume && (args.length || patchInputs.length || assertionsInput)) ||
  (!resume && args.length !== 3)
) {
  console.error(
    'Usage: rebuild-generation.mjs <existing-output-root> <ops.json> <expected-slide-names.json> [--patch patch.json ...] [--assert-text assertions.json] [--preview] [--timeout-ms 60000] [--preview-timeout-ms 180000]\n       rebuild-generation.mjs --resume <generation-directory> [--retry-preview]',
  );
  process.exit(2);
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const generation = resume
  ? resolve(resume)
  : await mkdtemp(join(resolve(args[0]), 'deckuse-generation-'));
const workspace = join(generation, 'workspace');
const binary = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
};
let phase = 'new',
  revision,
  artifact,
  validatedSnapshot,
  failureKind;
let config,
  checkpoint = {},
  attempt,
  previewFailure;
async function nextBase(name) {
  if (
    !(await exists(join(generation, name + '.started.json'))) &&
    !(await exists(join(generation, name + '.json')))
  )
    return name;
  for (let n = 2; ; n++) {
    const base = `${name}.attempt-${n}`;
    if (
      !(await exists(join(generation, base + '.started.json'))) &&
      !(await exists(join(generation, base + '.json')))
    )
      return base;
  }
}
async function saveCheckpoint(patch) {
  checkpoint = { ...checkpoint, ...patch };
  const number =
    (await readdir(generation)).filter((name) => /^checkpoint-\d+\.json$/.test(name)).length + 1;
  await writeFile(
    join(generation, `checkpoint-${String(number).padStart(6, '0')}.json`),
    JSON.stringify(checkpoint),
    { flag: 'wx' },
  );
}
async function cli(argv, label = phase) {
  const base = await nextBase(label);
  attempt = base;
  const startedAt = Date.now();
  const timeout = label === 'preview' ? config.previewTimeoutMs : config.timeoutMs;
  const command = [
    binary,
    ...argv,
    ...(label === 'validate' ? ['--report', join(generation, base + '.full.json')] : []),
    '--json',
  ];
  await writeFile(
    join(generation, base + '.started.json'),
    JSON.stringify({ startedAt, argv: command, timeout }),
    { flag: 'wx' },
  );
  const result = spawnSync(process.execPath, command, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout,
    killSignal: 'SIGKILL',
    // Preserve host policy, including NODE_OPTIONS and an explicitly selected cleanup mode.
    env: { ...process.env, DECKUSE_RUN_ID: config.runId, DECKUSE_COMMAND_ID: base },
  });
  await writeFile(
    join(generation, base + '.process.json'),
    JSON.stringify({
      argv: command,
      runId: config.runId,
      commandId: base,
      startedAt,
      durationMs: Date.now() - startedAt,
      status: result.status,
      signal: result.signal,
      error: result.error?.message,
    }),
    { flag: 'wx' },
  );
  await writeFile(join(generation, base + '.stderr.txt'), result.stderr ?? '', { flag: 'wx' });
  await writeFile(join(generation, base + '.json'), result.stdout ?? '', { flag: 'wx' });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    failureKind = result.error.code === 'ETIMEDOUT' ? 'timeout' : 'process-error';
    throw result.error;
  }
  if (!result.stdout?.trim()) {
    failureKind = 'no-cli-envelope';
    throw Error(label + ' returned empty stdout');
  }
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    failureKind = 'invalid-cli-envelope';
    throw Error(label + ' returned invalid JSON');
  }
  if (
    result.status !== 0 ||
    envelope?.ok !== true ||
    (['validate', 'export'].includes(label) && envelope.data?.valid !== true)
  ) {
    let previewMessage;
    if (label === 'preview') {
      const failures = (envelope?.data?.results ?? []).filter((page) => !page.ok);
      const failedPage =
        failures.find((page) => page.errorDetails?.retryable === false) ?? failures[0];
      const details = envelope?.error?.details ?? failedPage?.errorDetails;
      previewMessage = failedPage?.error;
      previewFailure = {
        code: envelope?.error?.code ?? failedPage?.errorCode ?? 'PREVIEW_FAILED',
        stage: details?.stage,
        retryable:
          details?.retryable === true &&
          failures.every((page) => page.errorDetails?.retryable === true),
      };
    }
    throw Error(envelope?.error?.message ?? previewMessage ?? label + ' failed');
  }
  return { data: envelope.data, base };
}
async function report(result) {
  const base = await nextBase('run');
  const path = join(generation, base + '.json');
  const data = {
    runId: config?.runId,
    generation,
    workspace,
    phase,
    revision,
    attempt,
    visualReview: 'not-performed',
    verification: {
      structure: artifact || validatedSnapshot ? 'validated' : 'unverified',
      preview:
        result.state === 'preview-ready'
          ? 'generated'
          : result.state === 'preview-blocked'
            ? 'blocked'
            : 'not-performed',
      visualReview: 'not-performed',
      nativeReview: 'not-performed',
    },
    nextAction: { type: 'inspect-report', path },
    ...result,
  };
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...data, report: path }));
}
async function inspectPptx(path) {
  const bytes = await readFile(path);
  if (!bytes.length) throw Error('PPTX is empty');
  const archive = await OpcArchive.open(bytes);
  const names = buildIndex(archive, workspace, revision)
    .elements.filter((item) => item.kind === 'slide')
    .map((item) => item.name);
  if (
    names.length !== config.expected.length ||
    config.expected.some((name, i) => name !== names[i])
  )
    throw Error('PPTX slide inventory does not match the expected order');
  return { sha256: hash(bytes), slides: names.length };
}
async function inspectSnapshot() {
  const metadataPath = join(workspace, '.deckuse', 'manifest.json');
  const before = await readFile(metadataPath, 'utf8');
  const manifest = JSON.parse(before);
  const path = join(workspace, 'package.pptx');
  const inspected = await inspectPptx(path);
  if (
    manifest.format !== 'pptx' ||
    manifest.revision !== revision ||
    !manifest.files?.some(
      (file) => file.path === 'package.pptx' && file.checksum === inspected.sha256,
    ) ||
    before !== (await readFile(metadataPath, 'utf8'))
  )
    throw Error('Snapshot no longer matches the validated workspace revision');
  return { path, revision, slideNames: config.expected, ...inspected };
}
async function expectedOperationDigest() {
  const raw = await readFile(join(generation, 'ops.json'), 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw.split(/\r?\n/).filter(Boolean).map(JSON.parse);
  }
  const values = Array.isArray(parsed) ? parsed : (parsed.operations ?? [parsed]);
  const extras = {
    version: '2.0',
    workspaceId: workspace,
    transactionId: '1',
    expectRevision: '1',
    requestId: config.requestId,
  };
  const command = values.every((value) => value && 'op' in value)
    ? { ...extras, type: 'applyTransaction', operations: values }
    : {
        ...extras,
        type: 'batch',
        atomic: true,
        commands: values.flatMap((value) =>
          value.type === 'batch' ? value.commands : [{ ...extras, ...value }],
        ),
      };
  return operationDigest(commandSchema.parse(command));
}
async function liveStatus() {
  const { data } = await cli(['status', '--workspace', workspace], 'reconcile-status');
  if (
    data.packageStale !== false ||
    data.health?.recovery !== 'clean' ||
    data.health?.history !== 'available'
  )
    throw Error('Workspace state is not clean; preserve it for reconciliation');
  return data;
}
async function run() {
  try {
    if (resume) {
      config = JSON.parse(await readFile(join(generation, 'generation.json'), 'utf8'));
      if (config.schemaVersion !== 1)
        throw Error('Generation lacks a supported continuation manifest');
      const ops = await readFile(join(generation, 'ops.json'));
      const names = await readFile(join(generation, 'expected-slide-names.json'));
      if (hash(ops) !== config.operationsSha256 || hash(names) !== config.namesSha256)
        throw Error('Saved generation inputs changed; resume refused');
      for (const source of config.recipeInputs ?? []) {
        if (
          !/^recipe-\d+\.json$/.test(source.file) ||
          hash(await readFile(join(generation, source.file))) !== source.sha256
        )
          throw Error('Saved recipe inputs changed; resume refused');
      }
      if (
        config.assertionsSha256 &&
        hash(await readFile(join(generation, 'assertions.json'))) !== config.assertionsSha256
      )
        throw Error('Saved assertions changed; resume refused');
      const checkpoints = (await readdir(generation))
        .filter((name) => /^checkpoint-\d+\.json$/.test(name))
        .sort();
      if (checkpoints.length)
        checkpoint = JSON.parse(await readFile(join(generation, checkpoints.at(-1)), 'utf8'));
      config.timeoutMs = duration(timeoutValue, config.timeoutMs);
      config.previewTimeoutMs = duration(previewTimeoutValue, config.previewTimeoutMs);
      config.preview ||= requestedPreview || checkpoint.previewRequested;
      revision = checkpoint.revision;
      // Inspect committed state before skipping any stage. Never infer success from empty stdout.
      if (checkpoint.initialized || (await exists(join(workspace, '.deckuse', 'manifest.json')))) {
        const status = await liveStatus();
        const applyStarted = (await readdir(generation)).some((name) =>
          /^apply(?:\.attempt-\d+)?\.started\.json$/.test(name),
        );
        if (applyStarted) {
          const { data: receipt } = await cli(
            ['status', '--workspace', workspace, '--request-id', config.requestId],
            'reconcile-receipt',
          );
          if (
            receipt.state !== 'committed' ||
            receipt.current !== true ||
            receipt.previousRevision !== '1' ||
            receipt.operationSha256 !== (await expectedOperationDigest()) ||
            receipt.revision !== status.revision ||
            (revision && receipt.revision !== revision)
          )
            throw Error(
              'Apply outcome is unknown, rejected or stale; preserve the request and do not replay',
            );
          revision = receipt.revision;
          const snapshot = await inspectSnapshot();
          if (checkpoint.snapshotSha256 && snapshot.sha256 !== checkpoint.snapshotSha256)
            throw Error('Workspace snapshot changed');
          await saveCheckpoint({
            initialized: true,
            applied: true,
            revision,
            snapshotSha256: snapshot.sha256,
          });
        } else {
          if (status.revision !== '1') throw Error('Initialization revision changed');
          await saveCheckpoint({ initialized: true });
        }
      } else if (await exists(join(generation, 'new.started.json'))) {
        throw Error('Initialization outcome is unknown; preserve this generation');
      }
    } else {
      let operations = await readFile(args[1]);
      const recipeInputs = [];
      if (patchInputs.length) {
        const compiled = [];
        for (const [i, path] of [args[1], ...patchInputs].entries()) {
          const bytes = await readFile(path);
          const values = JSON.parse(bytes);
          if (
            !Array.isArray(values) ||
            values.some((value) => !value || typeof value.type !== 'string' || 'op' in value)
          )
            throw Error('--patch recipes require arrays of high-level operations');
          compiled.push(...values);
          const file = `recipe-${i}.json`;
          await writeFile(join(generation, file), bytes, { flag: 'wx' });
          recipeInputs.push({ file, sha256: hash(bytes), role: i === 0 ? 'base' : 'patch' });
        }
        operations = Buffer.from(JSON.stringify(compiled));
      }
      let assertions;
      if (assertionsInput) {
        const { textAssertionsSchema } = await import('../dist/text-assertions.js');
        assertions = await readFile(assertionsInput);
        textAssertionsSchema.parse(JSON.parse(assertions));
        await writeFile(join(generation, 'assertions.json'), assertions, { flag: 'wx' });
      }
      const names = await readFile(args[2]);
      const expected = JSON.parse(names);
      if (
        !Array.isArray(expected) ||
        !expected.length ||
        expected.some((name) => typeof name !== 'string' || !name) ||
        new Set(expected).size !== expected.length
      )
        throw Error('Expected a nonempty JSON array of unique slide names');
      const requestId = randomUUID();
      config = {
        schemaVersion: 1,
        runId: process.env.DECKUSE_RUN_ID ?? requestId,
        requestId,
        expected,
        operationsSha256: hash(operations),
        namesSha256: hash(names),
        recipeInputs,
        ...(assertions ? { assertionsSha256: hash(assertions) } : {}),
        preview: requestedPreview,
        timeoutMs: duration(timeoutValue, 60000),
        previewTimeoutMs: duration(previewTimeoutValue, 180000),
      };
      await writeFile(join(generation, 'ops.json'), operations, { flag: 'wx' });
      await writeFile(join(generation, 'expected-slide-names.json'), names, { flag: 'wx' });
      await writeFile(join(generation, 'generation.json'), JSON.stringify(config), { flag: 'wx' });
      await writeFile(
        join(generation, 'request.json'),
        JSON.stringify({ requestId, expectedRevision: '1' }),
        { flag: 'wx' },
      );
    }
    await saveCheckpoint({ previewRequested: Boolean(config.preview) });
    if (!checkpoint.initialized) {
      await cli(['new', workspace, '--blank']);
      await saveCheckpoint({ initialized: true });
    }
    phase = 'apply';
    if (!checkpoint.applied) {
      const { data } = await cli([
        'apply',
        workspace,
        '--input',
        join(generation, 'ops.json'),
        '--request-id',
        config.requestId,
        '--expect-revision',
        '1',
        '--summary',
      ]);
      revision = data.revision;
      if (revision !== '2') throw Error('Fresh generation expected revision 2');
      await saveCheckpoint({ applied: true, revision });
    }
    phase = 'validate';
    if (!checkpoint.validated) {
      const { base } = await cli([
        'validate',
        '--workspace',
        workspace,
        '--expect-revision',
        revision,
        '--expect-slides',
        String(config.expected.length),
        '--expect-slide-names',
        join(generation, 'expected-slide-names.json'),
        '--summary',
        '--render',
        ...(config.assertionsSha256 ? ['--assert-text', join(generation, 'assertions.json')] : []),
      ]);
      phase = 'export';
      validatedSnapshot = await inspectSnapshot();
      await saveCheckpoint({
        validated: true,
        validationReport: join(generation, base + '.json'),
        snapshotSha256: validatedSnapshot.sha256,
      });
    } else validatedSnapshot = await inspectSnapshot();
    if (validatedSnapshot.sha256 !== checkpoint.snapshotSha256)
      throw Error('Validated snapshot changed');
    phase = 'export';
    if (checkpoint.artifact) {
      const inspected = await inspectPptx(checkpoint.artifact.output);
      if (
        inspected.sha256 !== checkpoint.artifact.sha256 ||
        inspected.sha256 !== validatedSnapshot.sha256
      )
        throw Error('Published artifact changed');
      artifact = checkpoint.artifact;
    } else {
      // A failed publish may have left a file; use a fresh name, preserving evidence.
      let output = join(generation, 'presentation.pptx');
      if (await exists(output)) output = join(generation, `presentation-${randomUUID()}.pptx`);
      const { data } = await cli([
        'export',
        output,
        '--workspace',
        workspace,
        '--revision',
        revision,
        '--from-package',
      ]);
      if (data.revision !== revision) throw Error('Export revision does not match validation');
      const inspected = await inspectPptx(output);
      if (inspected.sha256 !== validatedSnapshot.sha256)
        throw Error('Export does not match the validated snapshot');
      artifact = { output, ...inspected };
      await saveCheckpoint({ artifact });
    }
    if (config.preview) {
      phase = 'preview';
      if (checkpoint.previewFailure?.retryable === false && !retryPreview) {
        previewFailure = checkpoint.previewFailure;
        throw Error(
          'Preview remains blocked. Deliver the validated PPTX and retry only after confirming host capability has changed.',
        );
      }
      const { data: result, base } = await cli([
        'render',
        ...(resume ? ['--since-revision', revision] : ['--all']),
        '--workspace',
        workspace,
        '--output-dir',
        join(generation, 'preview'),
        '--contact-sheet',
      ]);
      if (
        result.revision !== revision ||
        result.inputSha256 !== artifact.sha256 ||
        result.results.length !== config.expected.length ||
        result.results.some(
          (page, i) => !page.ok || page.page !== i + 1 || page.result?.revision !== revision,
        )
      )
        throw Error('Preview does not match the exported generation');
      await saveCheckpoint({
        previewReport: join(generation, base + '.json'),
        previewFailure: null,
      });
    }
    await report({
      ok: true,
      ...artifact,
      state: config.preview ? 'preview-ready' : 'structural-only',
      validationReport: checkpoint.validationReport,
      ...(config.preview ? { previewInventory: checkpoint.previewReport } : {}),
      nextAction: {
        type: config.preview ? 'review-preview' : 'deliver-validated-pptx',
        path: config.preview ? checkpoint.previewReport : artifact.output,
      },
    });
  } catch (cause) {
    process.exitCode = 1;
    const previewBlocked = Boolean(artifact && phase === 'preview');
    if (previewBlocked) {
      previewFailure ??= { code: failureKind ?? 'PREVIEW_FAILED', retryable: false };
      if (previewFailure !== checkpoint.previewFailure) await saveCheckpoint({ previewFailure });
    }
    let recoverableSnapshot;
    if (phase === 'export' && validatedSnapshot) {
      const candidate = await inspectSnapshot().catch(() => undefined);
      if (candidate?.sha256 === validatedSnapshot.sha256) recoverableSnapshot = candidate;
    }
    await report({
      ok: false,
      ...artifact,
      state: previewBlocked
        ? 'preview-blocked'
        : recoverableSnapshot
          ? 'recoverable-snapshot'
          : 'failed',
      ...(recoverableSnapshot ? { recoverableSnapshot } : {}),
      ...(previewBlocked
        ? {
            previewFailure,
            validationReport: checkpoint.validationReport,
            nextAction: { type: 'deliver-validated-pptx', path: artifact.output },
          }
        : phase === 'apply'
          ? { nextAction: { type: 'resume-generation', path: generation } }
          : {}),
      ...(failureKind ? { failureKind } : {}),
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
// Serialize continuations so they cannot publish or append conflicting attempts.
try {
  await withWriteLock(generation, run);
} catch (cause) {
  process.exitCode = 1;
  await report({ ok: false, state: 'failed', error: String(cause) });
}
