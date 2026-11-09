#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [baseline, candidate, report, preview] = process.argv.slice(2);
if (!baseline || !candidate || !report || (preview && preview !== '--preview'))
  throw new Error(
    'Usage: benchmark-managed-replay.mjs <baseline-cli> <candidate-cli> <new-report.json> [--preview]',
  );

const root = await mkdtemp(join(tmpdir(), 'deckuse-managed-replay-'));
const input = join(root, 'create.json');
const patch = join(root, 'patch.json');
const names = Array.from({ length: 9 }, (_, i) => `Page ${i + 1}`);
const shapes = names.flatMap((slide, page) =>
  Array.from({ length: 21 }, (_, i) => ({
    type: 'addShape',
    slide,
    name: `Text-${i}`,
    shapeType: 'text',
    x: `${50 + (i % 3) * 400}px`,
    y: `${60 + Math.floor(i / 3) * 85}px`,
    width: '365px',
    height: '52px',
    blocks: [
      {
        text: `第 ${page + 1} 页 · 项目 ${i + 1} · Editable text`,
        fontSize: 20,
      },
    ],
  })),
);
const operations = [
  ...names.map((name) => ({ type: 'addSlide', name, layout: 'Blank' })),
  { type: 'remove', target: 'slide:1' },
  ...shapes,
];
await writeFile(input, JSON.stringify(operations));
await writeFile(
  patch,
  JSON.stringify([
    {
      type: 'setText',
      target: 'slide:1/shape:Text-0',
      value: '更新后的标题 · Revised title',
    },
  ]),
);

const rows = [];
for (let trial = 1; trial <= 3; trial++) {
  for (const [label, executable] of [
    ['baseline', baseline],
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
    const row = { label, trial, commands, trace, outcome: 'failed' };
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
      if (applied.revision !== '3' || applied.affectedSlides.join() !== '1')
        throw new Error('Patch did not update only page 1');
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
          rendered.results.length !== 9 ||
          rendered.results.some((page, i) => !page.ok || page.page !== i + 1) ||
          rendered.results[0]?.reusedFromRevision ||
          rendered.results.slice(1).some((page) => page.reusedFromRevision !== '2')
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
  ['baseline', 'candidate'].map((label) => {
    const trials = rows.filter((row) => row.label === label);
    const elapsed = trials.map((row) => row.elapsedMs).sort((a, b) => a - b);
    return [label, { medianMs: elapsed[1], outcomes: trials.map((row) => row.outcome) }];
  }),
);
await writeFile(
  report,
  JSON.stringify(
    { root, operations: operations.length, shapes: shapes.length, summary, rows },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify({ summary, report: resolve(report) }));
if (rows.some((row) => !['preview-ready', 'structural-only'].includes(row.outcome)))
  process.exitCode = 1;
