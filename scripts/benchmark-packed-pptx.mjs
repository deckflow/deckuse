#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, platform, arch } from 'node:os';
import { join, resolve } from 'node:path';

const reportPath = resolve(process.argv[2] ?? 'benchmark-packed-pptx.json');
const slideCount = Number(process.argv[3] ?? 8);
if (![8, 12].includes(slideCount)) throw new Error('Choose an 8- or 12-slide fixture');
const root = await mkdtemp(join(tmpdir(), 'deckuse-packed-benchmark-'));
try {
  const [tarball] = JSON.parse(
    execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], {
      encoding: 'utf8',
    }),
  );
  const startInstall = performance.now();
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--cache',
      join(root, 'npm-cache'),
      join(root, tarball.filename),
    ],
    { cwd: root, stdio: 'inherit' },
  );
  const installMs = performance.now() - startInstall;
  const binary = join(root, 'node_modules/@deckflow/deckuse/dist/bin.js');
  const ops = join(root, 'create.json');
  const edit = join(root, 'edit.json');
  const slides = Array.from({ length: slideCount - 1 }, () => ({
    type: 'addSlide',
    layout: 'Blank',
  }));
  const shapes = Array.from({ length: slideCount * 20 }, (_, i) => ({
    type: 'addShape',
    slide: 1 + Math.floor(i / 20),
    shapeType: 'text',
    name: 'Benchmark-' + i,
    text: 'Editable text ' + i,
    x: (i % 4) * 23 + 4 + '%',
    y: Math.floor((i % 20) / 4) * 15 + 10 + '%',
    width: '20%',
    height: '35px',
  }));
  await writeFile(ops, JSON.stringify([...slides, ...shapes]));
  await writeFile(
    edit,
    JSON.stringify([
      { type: 'setText', target: 'slide:1/shape:Benchmark-0', value: 'Updated text' },
    ]),
  );
  const runs = [];
  for (let iteration = 1; iteration <= 3; iteration++) {
    const workspace = join(root, 'workspace-' + iteration);
    const trace = join(root, 'timings-' + iteration + '.jsonl');
    const wallMs = {};
    function cli(phase, args) {
      const start = performance.now();
      const output = execFileSync(process.execPath, [binary, ...args, '--json'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, DECKUSE_TIMINGS_FILE: trace },
      });
      wallMs[phase] = performance.now() - start;
      const envelope = JSON.parse(output);
      if (!envelope.ok || envelope.data?.valid === false) throw new Error('Failed phase: ' + phase);
      return envelope.data;
    }
    cli('firstContext', ['agent-context', '--format', 'pptx', '--scenario', 'create']);
    cli('initialize', ['new', workspace, '--blank']);
    cli('apply', ['apply', '--workspace', workspace, '--input', ops]);
    cli('validate', ['validate', '--workspace', workspace]);
    cli('firstExport', [
      'export',
      join(root, 'first-' + iteration + '.pptx'),
      '--workspace',
      workspace,
    ]);
    cli('incrementalApply', [
      'apply',
      '--workspace',
      workspace,
      '--input',
      edit,
      '--expect-revision',
      '2',
    ]);
    cli('incrementalExport', [
      'export',
      join(root, 'incremental-' + iteration + '.pptx'),
      '--workspace',
      workspace,
    ]);
    runs.push({
      iteration,
      wallMs,
      phases: (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse),
    });
  }
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        package: tarball.filename,
        environment: { node: process.version, platform: platform(), arch: arch() },
        slideCount,
        shapeCount: shapes.length,
        installMs,
        runs,
        scope:
          'Local process-cold CLI runs. npm uses a fresh cache. No preview or host scheduling time.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(reportPath);
} finally {
  await rm(root, { recursive: true, force: true });
}
