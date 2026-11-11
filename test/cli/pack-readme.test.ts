import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('packs linked documentation without changing the working or staged README', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-pack-readme-'));
  const packageDir = join(root, 'package');
  const tarballs = join(root, 'tarballs');
  await mkdir(packageDir);
  await mkdir(tarballs);
  const manifest = await readFile('package.json', 'utf8');
  await writeFile(join(packageDir, 'package.json'), manifest);
  const staged = (await readFile('README.md', 'utf8')) + '\nStaged documentation marker\n';
  const readme = join(packageDir, 'README.md');
  await writeFile(readme, staged);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: packageDir, encoding: 'utf8' });
  git('init', '-q');
  git('add', 'README.md');
  const working = staged + '\nUnstaged documentation marker\n';
  await writeFile(readme, working);
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', tarballs], {
      cwd: packageDir,
      encoding: 'utf8',
    }),
  );
  const bytes = execFileSync(
    'tar',
    ['-xOf', join(tarballs, packed[0].filename), 'package/README.md'],
    {
      encoding: 'utf8',
    },
  );
  expect(bytes).toBe(working);
  expect(bytes).toContain('https://github.com/deckflow/deckuse/blob/main/docs/edition.md');
  expect(await readFile(readme, 'utf8')).toBe(working);
  expect(git('show', ':README.md')).toBe(staged);
  const minimum = JSON.parse(manifest).engines.node.replace(/^>=/, '');
  for (const path of (await readdir('.')).filter((name) => /^README(?:\..+)?\.md$/.test(name))) {
    const content = await readFile(path, 'utf8');
    expect(content).toContain(`[![Node.js ${minimum}+]`);
    expect(content.split('Node.js ' + minimum)).toHaveLength(3);
  }
}, 20000);
