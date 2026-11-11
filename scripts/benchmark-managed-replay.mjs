#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const take = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) throw Error('Missing ' + name);
  args.splice(i, 2);
  return value;
};
const scenario = take('--scenario') ?? 'nine-slide';
if (!['nine-slide', 'ten-slide', 'eleven-slide'].includes(scenario))
  throw Error('Unknown scenario');
const reference = take('--reference-cli');
const [baseline, candidate, report, preview] = args;
if (!baseline || !candidate || !report || (preview && preview !== '--preview'))
  throw new Error(
    'Usage: benchmark-managed-replay.mjs <baseline-cli> <candidate-cli> <new-report.json> [--preview]',
  );

const root = await mkdtemp(join(tmpdir(), 'deckuse-managed-replay-'));
const input = join(root, 'create.json');
const patch = join(root, 'patch.json');
const pageCount = scenario === 'eleven-slide' ? 11 : scenario === 'ten-slide' ? 10 : 9;
const objectsPerPage = scenario === 'eleven-slide' ? 18 : scenario === 'ten-slide' ? 26 : 21;
const names = Array.from({ length: pageCount }, (_, i) =>
  scenario === 'eleven-slide' && i === 0 ? 'Blank starter' : `Page ${i + 1}`,
);
const shapes = names.flatMap((slide, page) =>
  Array.from(
    { length: objectsPerPage + (scenario === 'eleven-slide' && page < 2 ? 1 : 0) },
    (_, i) => ({
      type: 'addShape',
      slide,
      name: `Text-${i}`,
      shapeType: 'text',
      x: `${50 + (i % 3) * 400}px`,
      y: `${60 + Math.floor(i / 3) * (pageCount === 10 ? 68 : 85)}px`,
      width: '365px',
      height: '52px',
      blocks: [
        {
          text: `第 ${page + 1} 页 · 项目 ${i + 1} · Editable text`,
          fontSize: 20,
        },
      ],
    }),
  ),
);
const operations = [
  ...(scenario === 'eleven-slide' ? names.slice(1) : names).map((name) => ({
    type: 'addSlide',
    name,
    layout: 'Blank',
  })),
  ...(scenario === 'eleven-slide' ? [] : [{ type: 'remove', target: 'slide:1' }]),
  ...shapes,
];
await writeFile(input, JSON.stringify(operations));
const changedPages = scenario === 'eleven-slide' ? [2, 4, 5, 6, 7, 8] : [1];
const patches =
  scenario === 'eleven-slide'
    ? changedPages.flatMap((page, i) =>
        Array.from({ length: [3, 6, 2, 1, 2, 2][i] }, (_, shape) => ({
          type: 'replaceText',
          find: `第 ${page} 页 · 项目 ${shape + 1} · Editable text`,
          replace: `第 ${page} 页 · 项目 ${shape + 1} · Reviewed text`,
        })),
      )
    : [{ type: 'setText', target: 'slide:1/shape:Text-0', value: '更新后的标题 · Revised title' }];
await writeFile(patch, JSON.stringify(patches));

const rows = [];
for (let trial = 1; trial <= 3; trial++) {
  for (const [label, executable] of [
    ['baseline', baseline],
    ...(reference ? [['reference', reference]] : []),
    ['candidate', candidate],
  ]) {
    const cli = resolve(executable);
    const workspace = join(root, `${label}-${trial}`);
    const trace = workspace + '.jsonl';
    const first = workspace + '.initial.pptx';
    const output = workspace + '.pptx';
    const previews = workspace + '-preview';
    const runId = randomUUID();
    const commands = [];
    const started = performance.now();
    let phase;
    const row = {
      label,
      trial,
      executable: cli,
      entrypointSha256: createHash('sha256')
        .update(await readFile(cli))
        .digest('hex'),
      commands,
      trace,
      outcome: 'failed',
    };
    function run(name, args, valid = false) {
      phase = name;
      const at = performance.now();
      const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
        encoding: 'utf8',
        timeout: 60_000,
        env: {
          ...process.env,
          DECKUSE_RUN_ID: runId,
          DECKUSE_COMMAND_ID: name,
          DECKUSE_TIMINGS_FILE: trace,
        },
      });
      commands.push({
        name,
        startMs: at - started,
        endMs: performance.now() - started,
        status: result.status,
      });
      if (result.error) throw result.error;
      const envelope = JSON.parse(result.stdout);
      if (result.status !== 0 || envelope.ok !== true || (valid && envelope.data?.valid !== true))
        throw new Error(envelope.error?.message ?? result.stderr ?? name);
      return envelope.data;
    }
    try {
      run('context', ['agent-context', '--format', 'pptx', '--scenario', 'create']);
      run('initialize', ['new', workspace, '--blank']);
      run('apply', [
        'apply',
        '--workspace',
        workspace,
        '--input',
        input,
        '--request-id',
        'create',
        '--expect-revision',
        '1',
        '--summary',
      ]);
      run('validate', ['validate', '--workspace', workspace], true);
      run('export', ['export', first, '--workspace', workspace, '--from-package'], true);
      if (preview)
        run('preview', ['render', '--workspace', workspace, '--all', '--output-dir', previews]);
      const applied = run('patch', [
        'apply',
        '--workspace',
        workspace,
        '--input',
        patch,
        '--request-id',
        'patch',
        '--expect-revision',
        '2',
        '--summary',
      ]);
      if (applied.revision !== '3' || applied.affectedSlides.join() !== changedPages.join())
        throw new Error('Patch did not update exactly the expected pages');
      run('validate-patch', ['validate', '--workspace', workspace], true);
      run('export-patch', ['export', output, '--workspace', workspace, '--from-package'], true);
      const sha256 = createHash('sha256')
        .update(await readFile(output))
        .digest('hex');
      const slides = run('inventory', ['list', 'slides', '--workspace', workspace]);
      if (JSON.stringify(slides.items.map((item) => item.name)) !== JSON.stringify(names))
        throw new Error('Unexpected slide order');
      Object.assign(row, { output, sha256, outcome: 'structural-only' });
      if (preview) {
        const rendered = run('preview-patch', [
          'render',
          '--workspace',
          workspace,
          '--since-revision',
          '2',
          '--contact-sheet',
          '--output-dir',
          previews,
        ]);
        if (
          rendered.revision !== '3' ||
          rendered.inputSha256 !== sha256 ||
          rendered.results.length !== pageCount ||
          rendered.results.some((page, i) => !page.ok || page.page !== i + 1) ||
          rendered.results.some((page) =>
            changedPages.includes(page.page)
              ? Boolean(page.reusedFromRevision)
              : page.reusedFromRevision !== '2',
          )
        )
          throw new Error('Incremental preview did not match the patched export');
        Object.assign(row, { outcome: 'preview-ready', contactSheet: rendered.contactSheet });
      }
    } catch (error) {
      Object.assign(row, {
        phase,
        error: String(error),
        outcome: phase?.startsWith('preview') ? 'preview-blocked' : 'failed',
      });
    }
    const elapsedMs = performance.now() - started;
    // Calls in this replay are sequential. Their sum equals the interval union.
    const toolUnionMs = commands.reduce((sum, call) => sum + call.endMs - call.startMs, 0);
    rows.push({ ...row, elapsedMs, toolUnionMs, unclassifiedHostModelMs: elapsedMs - toolUnionMs });
  }
}
const summary = Object.fromEntries(
  ['baseline', ...(reference ? ['reference'] : []), 'candidate'].map((label) => {
    const trials = rows.filter((row) => row.label === label);
    const elapsed = trials.map((row) => row.elapsedMs).sort((a, b) => a - b);
    return [label, { medianMs: elapsed[1], outcomes: trials.map((row) => row.outcome) }];
  }),
);
const verificationTrials = [];
if (scenario === 'eleven-slide') {
  const assertions = patches.slice(0, 5).flatMap((op) => [
    { text: op.replace, count: 1 },
    { text: op.find, count: 0 },
  ]);
  const assertionsFile = join(root, 'assertions.json');
  await writeFile(assertionsFile, JSON.stringify(assertions));
  for (let trial = 1; trial <= 3; trial++) {
    for (const [label, executable] of [
      ['baseline', baseline],
      ['candidate', candidate],
    ]) {
      const workspace = join(root, `${label}-${trial}`);
      const start = performance.now();
      function query(argv) {
        const result = spawnSync(
          process.execPath,
          [resolve(executable), ...argv, '--workspace', workspace, '--json'],
          { encoding: 'utf8', timeout: 60000 },
        );
        if (result.error || result.status !== 0) throw Error(result.stderr || String(result.error));
        const envelope = JSON.parse(result.stdout);
        if (!envelope.ok) throw Error('Verification command failed');
        return envelope.data;
      }
      if (label === 'baseline') {
        for (const assertion of assertions) {
          const result = query(['search', 'text', assertion.text]);
          if (!Array.isArray(result.matches) || result.matches.length !== assertion.count)
            throw Error('Baseline text assertion failed');
        }
      }
      const result = query([
        'validate',
        '--expect-revision',
        '3',
        '--summary',
        ...(label === 'candidate' ? ['--assert-text', assertionsFile] : []),
      ]);
      if (
        result.valid !== true ||
        (label === 'candidate' && result.textAssertions?.length !== assertions.length)
      )
        throw Error('Validation failed');
      verificationTrials.push({
        label,
        trial,
        calls: label === 'baseline' ? 11 : 1,
        durationMs: performance.now() - start,
      });
    }
  }
}
await writeFile(
  report,
  JSON.stringify(
    {
      root,
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      scenario,
      mode: 'control-replay',
      condition: 'process-cold',
      operations: operations.length,
      shapes: shapes.length,
      patchOperations: patches.length,
      changedPages,
      verificationTrials,
      summary,
      rows,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify({ summary, report: resolve(report) }));
if (rows.some((row) => !['preview-ready', 'structural-only'].includes(row.outcome)))
  process.exitCode = 1;
