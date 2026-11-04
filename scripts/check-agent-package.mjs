#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const staging = await mkdtemp(join(tmpdir(), 'deckuse-package-check-'));
const packed = JSON.parse(
  execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', staging], {
    encoding: 'utf8',
  }),
)[0];
execFileSync('tar', ['-xzf', join(staging, packed.filename), '-C', staging]);
const root = join(staging, 'package');
await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
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
const packageInfo = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (manifest.minimumCliVersion !== packageInfo.version)
  throw new Error('Skill capability baseline must match this package version');
const expectedScenarios = [
  'create',
  'replicate',
  'edit',
  'populate-template',
  'audit',
  'preview-export',
];
if (
  JSON.stringify(Object.keys(manifest.scenarios).sort()) !==
  JSON.stringify(expectedScenarios.sort())
)
  throw new Error('Missing scenario contract');
const resources = [
  manifest.entry,
  ...manifest.modules,
  ...manifest.evaluation,
  ...Object.values(manifest.scenarios).map((s) => s.resource),
  ...Object.values(manifest.formatOverrides).flatMap((s) => Object.values(s)),
];
for (const resource of resources) {
  const path = resolve(skillRoot, resource);
  if (!path.startsWith(skillRoot + '/')) throw new Error('Resource escapes skill package');
  await access(path);
}
const entry = await readFile(join(skillRoot, manifest.entry), 'utf8');
if (Buffer.byteLength(entry) > 8500) throw new Error('Skill entry exceeds lightweight budget');
const cases = JSON.parse(await readFile(join(skillRoot, 'routing-cases.json'), 'utf8'));
for (const scenario of expectedScenarios) {
  const selected = cases.filter((c) => c.expected === scenario);
  if (
    !selected.some((c) => /[\u3400-\u9fff]/u.test(c.prompt)) ||
    !selected.some((c) => /^[\x00-\x7f]+$/.test(c.prompt))
  )
    throw new Error('Missing bilingual evaluation cases for ' + scenario);
}

function cli(args) {
  return JSON.parse(
    execFileSync(process.execPath, [join(root, 'dist/bin.js'), ...args, '--json'], {
      encoding: 'utf8',
    }),
  );
}
const types = cli(['schema', '--list']).data;
if (!types.batchTypes.includes('addSlide')) throw new Error('Missing batch addSlide');
const recipe = await readFile(join(root, 'skills/deckuse/references/create-deck.md'), 'utf8');
const operations = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(recipe)[1]);
const ops = join(staging, 'ops.json');
await writeFile(ops, JSON.stringify(operations));
const ws = join(staging, 'presentation');
cli(['new', ws]);
cli(['apply', '--workspace', ws, '--input', ops]);
const status = cli(['status', '--workspace', ws]);
if (!status.data.valid) throw new Error('Invalid packaged presentation');
const shapes = cli(['list', 'shapes', '--slide', '1', '--workspace', ws]);
if (!JSON.stringify(shapes).includes('Updated introduction'))
  throw new Error('Recipe text missing');
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
const cards = join(staging, 'cards');
cli(['new', cards]);
cli(['apply', '--workspace', cards, '--input', join(skillRoot, 'assets/multilingual-cards.json')]);
if (!cli(['validate', '--workspace', cards]).data.valid) throw new Error('Invalid card recipe');
const slideDir = join(cards, 'source/ppt/slides');
const cardXml = (
  await Promise.all(
    (await readdir(slideDir))
      .filter((f) => f.endsWith('.xml'))
      .map((f) => readFile(join(slideDir, f), 'utf8')),
  )
).join('');
if (
  (cardXml.match(/<p:grpSp[ >]/g) ?? []).length !== 4 ||
  (cardXml.match(/<a:buChar /g) ?? []).length !== 15 ||
  !cardXml.includes('行动 6')
)
  throw new Error('Card grouping/native bullet/text contract failed');
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
