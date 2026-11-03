#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const dir = resolve(process.argv[2] ?? '/tmp/deckuse-benchmark-matrix');
await mkdir(dir, { recursive: true });
const cases = ['cold', 'warm'].flatMap((t) => Array.from({ length: 5 }, (_, i) => `${t}:${i}`));
let next = 0;
const jobs = 3;
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (next < cases.length) {
      const name = cases[next++];
      console.log(`Starting ${name}`);
      await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            'scripts/benchmark-agent-workflow.mjs',
            join(dir, name.replace(':', '-') + '.json'),
            '--render',
            `--case=${name}`,
          ],
          { stdio: 'inherit' },
        );
        child.once('error', reject);
        child.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`${name}: exit ${code}`)),
        );
      });
    }
  }),
);
const reports = await Promise.all(
  cases.map((name) =>
    readFile(join(dir, name.replace(':', '-') + '.json'), 'utf8').then(JSON.parse),
  ),
);
const rows = reports.flatMap((r) => r.rows);
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
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
await writeFile(
  join(dir, 'results.json'),
  JSON.stringify(
    {
      environment: reports[0].environment,
      concurrentCases: jobs,
      notes: [
        ...reports[0].notes,
        'Three benchmark cases ran concurrently; these are contention-inclusive measurements, not isolated machine performance.',
        'Rendering is compared on the batch-built deck only; content is identical.',
      ],
      summary,
      rows,
    },
    null,
    2,
  ),
);
console.log(join(dir, 'results.json'));
