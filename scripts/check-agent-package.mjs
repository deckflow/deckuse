#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const staging = await mkdtemp(join(tmpdir(), 'deckuse-package-check-'));
const packed = JSON.parse(
  execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', staging], {
    encoding: 'utf8',
  }),
)[0];
execFileSync(
  'npm',
  [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--cache',
    process.env.DECKUSE_PACKAGE_TEST_CACHE ?? join(staging, 'npm-cache'),
    join(staging, packed.filename),
  ],
  { cwd: staging, stdio: 'inherit' },
);
const root = join(staging, 'node_modules/@deckflow/deckuse');
for (const asset of [
  'assets/default.pptx',
  'assets/default.docx',
  'schema/command.schema.json',
  'skills/deckuse/SKILL.md',
  'docs/agent-reliability.md',
  'scripts/rebuild-generation.mjs',
  'scripts/managed-bootstrap.sh',
  'scripts/agent-log-analysis.mjs',
  'scripts/summarize-agent-benchmark.mjs',
])
  await access(join(root, asset));
async function references(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await references(path);
    else if (entry.name.endsWith('.md')) {
      const text = await readFile(path, 'utf8');
      for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
        const ref = match[1];
        if (!/^(https?:|#|mailto:)/.test(ref))
          await access(resolve(dirname(path), ref.split('#')[0]));
      }
    }
  }
}
await references(join(root, 'skills'));
const skillRoot = join(root, 'skills/deckuse');
const manifest = JSON.parse(await readFile(join(skillRoot, 'manifest.json'), 'utf8'));
const resources = [
  manifest.entry,
  ...manifest.examples,
  ...manifest.scripts,
  ...manifest.optionalModules,
  ...Object.values(manifest.scenarios).flatMap((s) => [s.resource, ...s.requiredModules]),
  ...Object.values(manifest.formatOverrides).flatMap((s) => Object.values(s)),
];
for (const resource of resources) {
  const path = resolve(skillRoot, resource);
  if (!path.startsWith(skillRoot + '/')) throw new Error('Resource escapes skill package');
  await access(path);
}
const entry = await readFile(join(skillRoot, manifest.entry), 'utf8');
if (Buffer.byteLength(entry) > 8500) throw new Error('Skill entry exceeds lightweight budget');
function cli(args) {
  return JSON.parse(
    execFileSync(process.execPath, [join(root, 'dist/bin.js'), ...args, '--json'], {
      encoding: 'utf8',
    }),
  );
}
const bin = join(staging, 'node_modules/.bin/deckuse');
const handoff = JSON.parse(execFileSync(bin, ['skill-path', '--json'], { encoding: 'utf8' })).data;
if (
  handoff.cli !== (await realpath(bin)) ||
  handoff.version !== packed.version ||
  handoff.skill !== (await realpath(join(skillRoot, manifest.entry))) ||
  handoff.nextAction.type !== 'read-file' ||
  handoff.nextAction.path !== handoff.skill
)
  throw new Error('Installed CLI resolved the wrong Skill: ' + JSON.stringify(handoff));
const routes = entry.split('## Start here')[1]?.split('## Choose a workflow')[0] ?? '';
const createRoute = routes.match(
  /`deckuse (agent-context --format pptx --scenario create) --json`/,
);
if (!createRoute || !routes.includes('deckuse status') || !routes.includes('deckuse validate'))
  throw new Error('Skill entry does not expose the executable workflow routes');
const types = cli(['schema', '--list']).data;
if (!types.batchTypes.includes('addSlide')) throw new Error('Missing batch addSlide');
const context = cli([
  'agent-context',
  '--format',
  'pptx',
  '--scenario',
  'create',
  '--include-schema',
]).data;
const probeHook = join(staging, 'browser-preflight-fault.mjs');
const converter = join(staging, 'version-only-converter');
await writeFile(converter, '#!/bin/sh\nprintf "%s\\n" "test converter 1"\n', { mode: 0o755 });
await writeFile(
  probeHook,
  `
  import fs from 'node:fs';
  import { syncBuiltinESMExports } from 'node:module';
  const mkdtemp = fs.promises.mkdtemp, rm = fs.promises.rm;
  const denial = () => Object.assign(new Error('Injected browser preflight denial'), { code: 'EACCES' });
  fs.promises.mkdtemp = async (prefix, ...args) => {
    if (String(prefix).includes('deckuse-browser-preflight-') && process.env.DECKUSE_PROBE_FAULT === 'create') throw denial();
    return mkdtemp(prefix, ...args);
  };
  fs.promises.rm = async (path, ...args) => {
    if (String(path).includes('deckuse-browser-preflight-') && process.env.DECKUSE_PROBE_FAULT === 'cleanup') throw denial();
    return rm(path, ...args);
  };
  syncBuiltinESMExports();
`,
);
function probeCli(args, fault) {
  const result = spawnSync(
    process.execPath,
    ['--import', probeHook, join(root, 'dist/bin.js'), ...args, '--json'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DECKUSE_PROBE_FAULT: fault,
        DECKUSE_DECK2HTML_BINARY: converter,
        DECKUSE_BROWSER_PROVIDER: 'headless-shell',
        DECKUSE_BROWSER_EXECUTION: 'allowed',
      },
    },
  );
  return { status: result.status, envelope: JSON.parse(result.stdout) };
}
const start = performance.now();
const compact = probeCli(createRoute[1].split(' '), 'create');
if (
  compact.status !== 0 ||
  compact.envelope.data.contracts ||
  compact.envelope.data.dependencies.browser.cacheWritable !== 'not-probed'
)
  throw new Error('Authoring context probed preview or returned protocol schema');
const contract = compact.envelope.data.applyContract.examples;
const photo = join(staging, 'photo.png');
await writeFile(
  photo,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/b1sAAAAASUVORK5CYII=',
    'base64',
  ),
);
const generatedOps = join(staging, 'compact-nine-page-ops.json');
const generatedNames = join(staging, 'compact-nine-page-names.json');
const inventory = ['Blank starter', ...Array.from({ length: 8 }, (_, i) => 'Page ' + (i + 2))];
await writeFile(
  generatedOps,
  JSON.stringify(
    inventory.flatMap((slide, i) => [
      ...(i ? [{ ...contract.slide, name: slide }] : []),
      { ...contract.nativeShape, slide },
      { ...contract.richText, slide },
      ...(i === 0 ? [{ ...contract.image, slide, file: photo }] : []),
    ]),
  ),
);
const timeToOperationsMs = performance.now() - start;
await writeFile(generatedNames, JSON.stringify(inventory));
for (const [fault, code] of [
  ['create', 'BROWSER_CACHE_UNWRITABLE'],
  ['cleanup', 'BROWSER_PREFLIGHT_CLEANUP_FAILED'],
]) {
  const result = probeCli(['render', '--preflight'], fault);
  if (
    result.status !== 1 ||
    result.envelope.error.code !== code ||
    (fault === 'cleanup' && result.envelope.error.details.previewSupported !== false)
  )
    throw new Error('Incorrect browser preflight diagnostic: ' + JSON.stringify(result));
}
const compactDeck = JSON.parse(
  execFileSync(
    process.execPath,
    [join(root, 'scripts/rebuild-generation.mjs'), staging, generatedOps, generatedNames],
    { encoding: 'utf8', env: { ...process.env, DECKUSE_BROWSER_EXECUTION: 'denied' } },
  ),
);
if (!compactDeck.ok || compactDeck.slides !== 9)
  throw new Error('Compact contract did not produce nine editable slides');
if (
  !cli(['status', '--workspace', compactDeck.workspace]).ok ||
  !cli(['validate', '--workspace', compactDeck.workspace]).ok
)
  throw new Error('Installed edit and preview routes could not inspect a generated workspace');
const firstPage = cli(['list', 'shapes', '--slide', '1', '--workspace', compactDeck.workspace]);
if (!JSON.stringify(firstPage).includes('产品 Overview'))
  throw new Error('Rich text was not preserved');
if (
  !firstPage.data.items.some((item) => item.kind === 'picture' && item.name === contract.image.name)
)
  throw new Error('Compact contract image did not produce a native picture');

await access(join(root, context.recipe.deliveryRunner.resource));
const ops = join(root, context.resource.example);
await access(ops);
process.env.DECKUSE_BROWSER_EXECUTION = 'denied';
const ws = join(staging, 'presentation');
cli(['new', ws, '--blank']);
cli([
  'apply',
  '--workspace',
  ws,
  '--input',
  ops,
  '--request-id',
  'create-1',
  '--expect-revision',
  '1',
]);
const expectedNames = join(staging, 'expected-slide-names.json');
await writeFile(expectedNames, JSON.stringify(['Blank starter', 'Details']));
const generated = JSON.parse(
  execFileSync(
    process.execPath,
    [join(root, 'scripts/rebuild-generation.mjs'), staging, ops, expectedNames],
    { encoding: 'utf8' },
  ),
);
if (generated.state !== 'structural-only' || !generated.sha256)
  throw new Error('Packaged generation runner did not verify an export');
await access(generated.output);
const original = await readFile(generated.output);
const runner = join(root, 'scripts/rebuild-generation.mjs');
const maskedExit = join(staging, 'masked-preview-exit.mjs');
await writeFile(
  maskedExit,
  `
  import processes from 'node:child_process';
  import { syncBuiltinESMExports } from 'node:module';
  const { spawnSync } = processes;
  processes.spawnSync = (binary, argv, options) => {
    const result = spawnSync(binary, argv, options);
    return argv[1] === 'render' ? { ...result, status: 0 } : result;
  };
  syncBuiltinESMExports();
`,
);

const deniedPreview = spawnSync(
  process.execPath,
  ['--import', maskedExit, runner, staging, ops, expectedNames, '--preview'],
  { encoding: 'utf8' },
);
const blocked = JSON.parse(deniedPreview.stdout);
if (deniedPreview.status !== 1 || blocked.state !== 'preview-blocked' || !blocked.output)
  throw Error('Unavailable preview did not preserve the structural artifact');
await access(blocked.output);
const previewProcess = JSON.parse(
  await readFile(join(blocked.generation, 'preview.process.json'), 'utf8'),
);
if (previewProcess.status !== 0) throw Error('Preview wrapper did not mask the child exit');
if (
  blocked.verification?.structure !== 'validated' ||
  blocked.verification.preview !== 'blocked' ||
  blocked.verification.visualReview !== 'not-performed' ||
  blocked.verification.nativeReview !== 'not-performed' ||
  blocked.previewFailure?.retryable !== false ||
  blocked.nextAction?.type !== 'deliver-validated-pptx' ||
  blocked.nextAction.path !== blocked.output
)
  throw Error('Expected a machine-readable structural handoff for blocked preview');
const resumedBlocked = spawnSync(process.execPath, [runner, '--resume', blocked.generation], {
  encoding: 'utf8',
  env: { ...process.env, DECKUSE_BROWSER_PROVIDER: 'chrome' },
});
const resumedReport = JSON.parse(resumedBlocked.stdout);
if (
  resumedBlocked.status !== 1 ||
  resumedReport.previewFailure?.code !== blocked.previewFailure.code ||
  resumedReport.nextAction?.path !== blocked.output ||
  resumedReport.sha256 !== blocked.sha256 ||
  (await readdir(blocked.generation)).filter((name) =>
    /^preview(?:\.attempt-\d+)?\.started\.json$/.test(name),
  ).length !== 1
)
  throw Error('Changing a preview setting replayed a nonretryable preview or lost its artifact');

const wrongNames = join(staging, 'wrong-slide-names.json');
await writeFile(wrongNames, JSON.stringify(['Blank starter', 'Unexpected']));
const invalidBuild = spawnSync(process.execPath, [runner, staging, ops, wrongNames], {
  encoding: 'utf8',
});
const invalid = JSON.parse(invalidBuild.stdout);
if (
  invalidBuild.status !== 1 ||
  invalid.state !== 'failed' ||
  invalid.output ||
  !(await readFile(generated.output)).equals(original)
)
  throw Error('Failed validation did not preserve the previous good output');
if (!cli(['schema', '--type', 'addShape']).ok)
  throw Error('Narrow lookup could not resolve an operation field');

await access(join(root, 'scripts/managed-bootstrap.sh'));
await access(join(root, 'scripts/benchmark-managed-replay.mjs'));
const loaded = JSON.parse(
  execFileSync(
    'python3',
    [
      join(skillRoot, 'scripts/load_context.py'),
      '--scenario',
      'create',
      '--format',
      'pptx',
      '--cache-dir',
      join(staging, 'context'),
      '--binary',
      join(staging, 'node_modules/.bin/deckuse'),
    ],
    { encoding: 'utf8' },
  ),
);
if (!loaded.contractReady || !loaded.capabilityFingerprint)
  throw new Error('Packaged context helper did not load v2');
const status = cli([
  'validate',
  '--workspace',
  ws,
  '--expect-revision',
  '2',
  '--expect-slides',
  '2',
  '--expect-slide-names',
  expectedNames,
]);
if (!status.data.valid) throw new Error('Invalid packaged presentation');
const summary = cli([
  'validate',
  '--workspace',
  ws,
  '--summary',
  '--render',
  '--report',
  join(staging, 'validation-report.json'),
]);
if (
  summary.data.renderPerformed !== false ||
  summary.data.inspection.slideCount !== 2 ||
  summary.data.inspection.verification.visualReview !== 'not-performed'
)
  throw Error('Invalid validation summary');
const continuation = JSON.parse(
  execFileSync(
    process.execPath,
    [join(root, 'scripts/rebuild-generation.mjs'), '--resume', generated.generation],
    { encoding: 'utf8' },
  ),
);
if (continuation.sha256 !== generated.sha256) throw Error('Continuation changed output');
const slides = cli(['list', 'slides', '--workspace', ws]).data.items;
if (slides.length !== 2) throw new Error('Expected two slides');
const shapes = cli(['list', 'shapes', '--slide', '2', '--workspace', ws]);
if (!JSON.stringify(shapes).includes('Editable details')) throw new Error('Recipe text missing');
const exported = join(staging, 'out.pptx');
cli(['export', exported, '--workspace', ws]);
await access(exported);
const help = execFileSync(process.execPath, [join(root, 'dist/bin.js'), 'apply', '--help'], {
  encoding: 'utf8',
});
const example = /Template[^\n]*:\n\n([\s\S]*?)\nExamples:/.exec(help)?.[1];
if (!example) throw new Error('Missing apply help template');
const helpOps = join(staging, 'help-ops.json');
await writeFile(helpOps, JSON.stringify(JSON.parse(example.trim())));
const helpWs = join(staging, 'help-example');
cli(['new', helpWs]);
cli(['apply', '--workspace', helpWs, '--input', helpOps]);
if (!cli(['status', '--workspace', helpWs]).data.valid) throw new Error('Invalid help example');
const doc = join(staging, 'word');
cli(['new', doc, '--format', 'docx']);
cli(['add', 'paragraph', '--workspace', doc, '--text', 'Package smoke']);
if (!cli(['status', '--workspace', doc]).data.valid) throw new Error('Invalid packaged DOCX');
cli(['export', join(staging, 'out.docx'), '--workspace', doc]);
console.log(
  JSON.stringify({
    ok: true,
    package: packed.filename,
    staging,
    timeToOperationsMs,
    checks: [
      'resources',
      'skill links',
      'command discovery',
      'atomic blank recipe',
      'packaged generation runner',
      'packaged v2 context loader',
      'pptx export',
      'docx write/export',
    ],
  }),
);
