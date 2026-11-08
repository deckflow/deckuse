#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const cli = resolve(process.argv[2] ?? 'dist/bin.js');
const render = process.argv.includes('--render');
const onlyRender = process.argv.includes('--only-render');
const root = await mkdtemp(join(tmpdir(), 'deckuse-create-benchmark-'));
const rows = [];
const ops = [
  ...Array.from({ length: 11 }, (_, i) => ({
    type: 'addSlide',
    layout: 'Blank',
    name: `S${i + 1}`,
  })),
  { type: 'remove', target: 'slide:1' },
  ...Array.from({ length: 351 }, (_, i) => ({
    type: 'addShape',
    slide: `S${(i % 11) + 1}`,
    shapeType: 'text',
    name: `T${i}`,
    x: `${20 + (i % 3) * 400}px`,
    y: `${20 + Math.floor(i / 33) * 60}px`,
    width: '380px',
    height: '50px',
    text: `中文排版与 English mix ${i}`,
  })),
];
const input = join(root, 'ops.json');
await writeFile(input, JSON.stringify(ops));

async function run(ws, label, args) {
  const trace = join(ws + '-' + label + '.jsonl');
  const start = performance.now();
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, DECKUSE_TIMINGS_FILE: trace, DECKUSE_COMMAND_ID: label },
  });
  const durationMs = performance.now() - start;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
  const output = JSON.parse(result.stdout);
  if (!output.ok) throw new Error(result.stdout);
  const phases = (await readFile(trace, 'utf8').catch(() => ''))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse);
  return {
    durationMs,
    stdoutBytes: Buffer.byteLength(result.stdout),
    fullIndexes: phases.filter((p) => p.phase === 'index').length,
    conversions: phases.filter((p) => p.phase === 'convert').length,
    phases,
  };
}

try {
  for (const temperature of ['process-cold', 'prewarmed']) {
    if (temperature === 'prewarmed') {
      const ws = join(root, 'warmup');
      await run(ws, 'new', ['new', ws]);
      await run(ws, 'apply', ['apply', ws, '--input', input]);
      if (render || onlyRender) await run(ws, 'render', ['render', '--workspace', ws, '--all']);
    }
    for (let i = 0; i < 5; i++) {
      const ws = join(root, `${temperature}-${i}`);
      await run(ws, 'new', ['new', ws]);
      const dryRun = onlyRender
        ? undefined
        : await run(ws, 'dry-run', ['apply', ws, '--input', input, '--dry-run']);
      const apply = await run(ws, 'apply', ['apply', ws, '--input', input]);
      const preview =
        render || onlyRender
          ? await run(ws, 'render', ['render', '--workspace', ws, '--all'])
          : undefined;
      rows.push({ temperature, dryRun, apply, preview });
      process.stderr.write(
        `${temperature} ${i + 1}: apply ${Math.round(apply.durationMs)}ms` +
          (preview ? `, render ${Math.round(preview.durationMs)}ms` : '') +
          '\n',
      );
    }
  }
  const summary = ['process-cold', 'prewarmed'].map((temperature) => ({
    temperature,
    ...Object.fromEntries(
      ['dryRun', 'apply', 'preview'].flatMap((key) => {
        const ms = rows
          .filter((row) => row.temperature === temperature)
          .map((row) => row[key]?.durationMs)
          .filter((x) => x !== undefined)
          .sort((a, b) => a - b);
        return ms.length ? [[key, { min: ms[0], median: ms[2], max: ms.at(-1) }]] : [];
      }),
    ),
  }));
  console.log(JSON.stringify({ cli, summary, rows }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
