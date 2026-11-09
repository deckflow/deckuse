#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, platform, arch } from 'node:os';
import { join, resolve } from 'node:path';

const reportPath = resolve(process.argv[2] ?? 'benchmark-packed-pptx.json');
const slideCount = Number(process.argv[3] ?? 8);
if (![6, 8, 12].includes(slideCount)) throw new Error('Choose a 6-, 8-, or 12-slide fixture');
const verifyPreview = slideCount === 6;
const runCount = verifyPreview ? 1 : 3;
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceDirty = Boolean(
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
);
const root = await mkdtemp(join(tmpdir(), 'deckuse-packed-benchmark-'));
try {
  const [tarball] = JSON.parse(
    execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], {
      encoding: 'utf8',
    }),
  );
  const packedBytes = await readFile(join(root, tarball.filename));
  const integrity = 'sha512-' + createHash('sha512').update(packedBytes).digest('base64');
  if (integrity !== tarball.integrity) throw new Error('npm pack integrity mismatch');
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
  const generationStart = performance.now();
  const slides = Array.from({ length: slideCount - 1 }, () => ({
    type: 'addSlide',
    layout: 'Blank',
  }));
  const shapes = verifyPreview
    ? Array.from({ length: slideCount }, (_, i) => ({
        type: 'addShape',
        slide: i + 1,
        shapeType: 'text',
        name: 'Benchmark-' + i,
        x: '1in',
        y: '1in',
        width: '10in',
        height: '4in',
        blocks: [
          { runs: [{ text: 'City cycling proposal', bold: true, fontSize: 30 }] },
          ...['Pilot scope', 'Bike storage', 'Safety guidance', 'Eligible participants'].map(
            (text) => ({ text, fontSize: 21 }),
          ),
        ],
      }))
    : Array.from({ length: slideCount * 20 }, (_, i) => ({
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
      verifyPreview
        ? { type: 'replaceText', selector: { page: 5 }, find: 'Eligible', replace: 'Pilot' }
        : { type: 'setText', target: 'slide:1/shape:Benchmark-0', value: 'Updated text' },
    ]),
  );
  const operationGenerationMs = performance.now() - generationStart;
  const installedVersion = execFileSync(process.execPath, [binary, '--version'], {
    encoding: 'utf8',
  }).trim();
  if (!installedVersion.startsWith('deckuse ' + tarball.version + ' '))
    throw new Error('Installed version mismatch');
  const runs = [];
  for (let iteration = 1; iteration <= runCount; iteration++) {
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
    if (verifyPreview) cli('browserProbe', ['render', '--preflight', '--probe-browser']);
    cli('initialize', ['new', workspace, '--blank']);
    const applied = cli('apply', [
      'apply',
      '--workspace',
      workspace,
      '--input',
      ops,
      '--request-id',
      'create',
      '--expect-revision',
      '1',
    ]);
    cli('validate', ['validate', '--workspace', workspace]);
    cli('firstExport', [
      'export',
      join(root, 'first-' + iteration + '.pptx'),
      '--workspace',
      workspace,
    ]);
    const patched = cli('incrementalApply', [
      'apply',
      '--workspace',
      workspace,
      '--input',
      edit,
      '--request-id',
      'patch',
      '--expect-revision',
      applied.revision,
    ]);
    const output = join(root, 'incremental-' + iteration + '.pptx');
    cli('incrementalExport', [
      'export',
      output,
      '--workspace',
      workspace,
      '--revision',
      patched.revision,
    ]);
    let preview;
    if (verifyPreview) {
      if (JSON.stringify(patched.affectedSlides) !== '[5]')
        throw new Error('Patch did not target page five');
      const same = cli('noOpProbe', [
        'apply',
        '--workspace',
        workspace,
        '--input',
        edit,
        '--request-id',
        'noop',
        '--expect-revision',
        patched.revision,
      ]);
      const receipt = cli('receiptProbe', [
        'status',
        '--workspace',
        workspace,
        '--request-id',
        'noop',
      ]);
      if (!same.noOp || receipt.state !== 'no-op' || same.revision !== patched.revision)
        throw new Error('No-op capability probe failed');
      cli('validateDelivery', [
        'validate',
        '--workspace',
        workspace,
        '--expect-revision',
        patched.revision,
        '--expect-slides',
        String(slideCount),
        '--level',
        'full',
        '--profile',
        'structure',
        '--package',
        '--relationships',
      ]);
      const outputDir = join(root, 'preview');
      const rendered = cli('render', [
        'render',
        '--workspace',
        workspace,
        '--all',
        '--contact-sheet',
        '--output-dir',
        outputDir,
      ]);
      const hash = createHash('sha256')
        .update(await readFile(output))
        .digest('hex');
      if (
        rendered.revision !== patched.revision ||
        rendered.inputSha256 !== hash ||
        rendered.results.length !== slideCount ||
        rendered.results.some((item, index) => !item.ok || item.page !== index + 1)
      )
        throw new Error('Render inventory, revision or input digest does not match export');
      preview = { revision: rendered.revision, sha256: hash, pageCount: rendered.results.length };
      if (process.env['DECKUSE_BENCHMARK_PREVIEW']) {
        await writeFile(
          process.env['DECKUSE_BENCHMARK_PREVIEW'],
          await readFile(rendered.contactSheet),
          { flag: 'wx' },
        );
      }
    }
    runs.push({
      iteration,
      wallMs,
      preview,
      phases: (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse),
    });
  }
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        package: {
          filename: tarball.filename,
          version: tarball.version,
          integrity,
          installedVersion,
          sourceCommit,
          sourceDirty,
        },
        environment: { node: process.version, platform: platform(), arch: arch() },
        slideCount,
        shapeCount: shapes.length,
        installMs,
        operationGenerationMs,
        hostWaitMs: null,
        modelTimeMs: null,
        fiveMinuteTargetMs: 300_000,
        runs,
        scope:
          'Local process-cold CLI runs with a fresh npm cache. Host authorization waits and model time are not measured.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(reportPath);
} finally {
  await rm(root, { recursive: true, force: true });
}
