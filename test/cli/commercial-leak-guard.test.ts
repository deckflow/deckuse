import { expect, it } from 'vitest';
import { mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it('allows only the dependency argument mapping while rejecting other license markers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-commercial-guard-'));
  await mkdir(join(root, 'src/edition-config'), { recursive: true });
  await copyFile('src/edition-config/index.ts', join(root, 'src/edition-config/index.ts'));
  const file = join(root, 'src/deck2html-exec.ts');
  const mapping = "const argumentsMap = [['license', '--license'],];";
  const check = () =>
    spawnSync(process.execPath, [resolve('scripts/assert-no-commercial-leak.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
  await writeFile(file, mapping);
  expect(check().status).toBe(0);
  for (const extra of [
    "const flag = '--license';",
    'function verifyLicense() {}',
    'function ensureActivated() {}',
  ]) {
    await writeFile(file, mapping + extra);
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Forbidden license/certificate marker');
  }
  await writeFile(file, mapping);
  await writeFile(join(root, 'src/other.ts'), mapping);
  expect(check().status).toBe(1);
});
