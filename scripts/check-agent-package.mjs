#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile, access } from 'node:fs/promises';
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
    join(staging, 'npm-cache'),
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
const status = cli(['validate', '--workspace', ws]);
if (!status.data.valid) throw new Error('Invalid packaged presentation');
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
    checks: [
      'resources',
      'skill links',
      'command discovery',
      'atomic blank recipe',
      'pptx export',
      'docx write/export',
    ],
  }),
);
