#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, platform, arch, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
const output = resolve(process.argv[2] ?? 'benchmark-agent-workflow.json');
const root = await mkdtemp(join(tmpdir(), 'deckuse-benchmark-'));
const cli = resolve('dist/bin.js');
const rows = [];
function command(args, timingFile) {
  const start = performance.now();
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, DECKUSE_TIMINGS_FILE: timingFile },
  });
  if (r.status !== 0) throw new Error(`${args.join(' ')}: ${r.stderr || r.stdout}`);
  return {
    durationMs: performance.now() - start,
    data: args.includes('--json') ? JSON.parse(r.stdout) : r.stdout,
  };
}
const content = Array.from({ length: 135 }, (_, i) => ({
  type: 'addShape',
  slide: 1 + (i % 8),
  shapeType: 'text',
  name: `Item${i}`,
  x: `${5 + (i % 3) * 30}%`,
  y: `${5 + Math.floor(i / 24) * 12}%`,
  width: '28%',
  height: '40px',
  text: `Benchmark ${i}`,
}));
const add = Array.from({ length: 7 }, () => ({ type: 'addSlide', layout: 'Blank' }));
const batchFile = join(root, 'batch.json');
await writeFile(batchFile, JSON.stringify([...add, ...content]));
for (const temperature of ['cold', 'warm'])
  for (let iteration = 0; iteration < 5; iteration++) {
    const selected = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7);
    if (selected && selected !== `${temperature}:${iteration}`) continue;
    // Warm means an explicit preload; cold is process-cold, not a claim of OS cache eviction.
    if (temperature === 'warm') command(['--version'], join(root, 'warmup.jsonl'));
    for (const mode of ['individual', 'batch']) {
      const ws = join(root, `${temperature}-${iteration}-${mode}`),
        trace = join(root, `${temperature}-${iteration}-${mode}.jsonl`);
      const startup = command(['--version'], trace).durationMs;
      command(['new', ws, '--json'], trace);
      const start = performance.now();
      if (mode === 'batch')
        command(['apply', '--workspace', ws, '--input', batchFile, '--json'], trace);
      else {
        for (const op of add)
          command(['add', 'slide', '--layout', 'Blank', '--workspace', ws, '--json'], trace);
        for (const [i, op] of content.entries()) {
          const file = join(root, `op-${i}.json`);
          await writeFile(file, JSON.stringify(op));
          command(['apply', '--workspace', ws, '--input', file, '--json'], trace);
        }
      }
      const buildMs = performance.now() - start;
      let phases = (await readFile(trace, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse);
      const render = [];
      if (process.argv.includes('--render') && mode === 'batch') {
        for (const rendering of ['individual', 'batch']) {
          const before = performance.now();
          let error;
          try {
            if (rendering === 'batch')
              command(
                [
                  'render',
                  '--all',
                  '--workspace',
                  ws,
                  '--output-dir',
                  join(root, 'render', `${temperature}-${iteration}-${mode}-batch`),
                  '--json',
                ],
                trace,
              );
            else
              for (let page = 1; page <= 8; page++)
                command(
                  [
                    'render',
                    '--page',
                    String(page),
                    '--workspace',
                    ws,
                    '--output',
                    join(root, 'render', `${temperature}-${iteration}-${mode}-${page}.png`),
                    '--json',
                  ],
                  trace,
                );
          } catch (cause) {
            error = String(cause);
          }
          render.push({
            mode: rendering,
            durationMs: performance.now() - before,
            ...(error ? { error } : {}),
          });
        }
      }
      phases = (await readFile(trace, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
      rows.push({
        traceFile: trace,
        temperature,
        iteration,
        mode,
        startupMs: startup,
        buildMs,
        writeProcesses: mode === 'batch' ? 1 : 142,
        phases,
        render,
      });
      console.log(`${temperature} ${iteration + 1}/5 ${mode}: ${Math.round(buildMs)}ms`);
      await save();
    }
  }
async function save() {
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const summary = ['cold', 'warm'].flatMap((temperature) =>
    ['individual', 'batch'].map((mode) => ({
      temperature,
      mode,
      medianBuildMs: median(
        rows.filter((r) => r.temperature === temperature && r.mode === mode).map((r) => r.buildMs),
      ),
    })),
  );
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        environment: {
          node: process.version,
          platform: platform(),
          arch: arch(),
          cpu: cpus()[0]?.model,
        },
        notes: [
          'Cold is process-cold; OS filesystem cache is not evicted.',
          'Startup probe is separate, not subtracted from command timings.',
          'Phase spans are nested; do not add them to wall time.',
          'Agent scheduling and approval waits are not measured by this local CLI benchmark.',
        ],
        summary,
        rows,
      },
      null,
      2,
    ),
  );
}
