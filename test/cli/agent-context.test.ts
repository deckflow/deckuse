import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { agentContext, taskSchemas } from '../../src/agent-context.js';
it('returns format/scenario/version-specific contracts without document creation or launch', async () => {
  const first = await agentContext({ format: 'pptx', scenario: 'create', includeSchema: true });
  expect(first.cliVersion).toBe(
    JSON.parse(
      await (
        await import('node:fs/promises')
      ).readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ).version,
  );
  expect(first.edition).toBe('community');
  expect(first.contracts?.anyOf.length).toBe(first.operationTypes.length);
  expect(first.recipe.cli.join('\n')).toContain('--input ./ops.json');
  expect(JSON.stringify(first)).not.toContain('workspaceId":"/');
  expect((await agentContext({ format: 'pptx', scenario: 'create' })).capabilityFingerprint).toBe(
    first.capabilityFingerprint,
  );
  expect((await agentContext({ format: 'docx' })).capabilityFingerprint).not.toBe(
    first.capabilityFingerprint,
  );
  expect((await agentContext({ scenario: 'edit' })).capabilityFingerprint).not.toBe(
    first.capabilityFingerprint,
  );
  await expect(agentContext({ format: 'xlsx' })).rejects.toThrow();
  await expect(agentContext({ format: 'docx', scenario: 'replicate' })).rejects.toThrow();
  expect(() => taskSchemas(['invented'])).toThrow();
  vi.stubEnv('DECKUSE_BROWSER_EXECUTION', 'denied');
  try {
    expect((await agentContext({})).dependencies.browser).toMatchObject({
      code: 'BROWSER_HOST_DENIED',
      launch: 'not-probed',
    });
  } finally {
    vi.unstubAllEnvs();
  }
});
it('executes the returned new/apply/validate/export recipe and reads workspace revision without changing it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-context-'));
  const cli = (...args: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, [resolve('dist/bin.js'), ...args, '--json'], {
        encoding: 'utf8',
        cwd: root,
      }),
    );
  const response = cli(
    'agent-context',
    '--format',
    'pptx',
    '--scenario',
    'create',
    '--include-schema',
  );
  expect(await readdir(root)).toEqual([]);
  expect(response.data.contracts).toBeDefined();
  const ws = join(root, 'ws');
  cli('new', ws);
  const ops = join(root, 'ops.json');
  await writeFile(ops, JSON.stringify(response.data.recipe.operations));
  cli('apply', '--workspace', ws, '--input', ops);
  expect(cli('validate', '--workspace', ws).data.valid).toBe(true);
  expect(cli('export', join(root, 'out.pptx'), '--workspace', ws).data.valid).toBe(true);
  const before = cli('status', '--workspace', ws).data.revision;
  const context = cli('agent-context', '--workspace', ws, '--scenario', 'edit');
  expect(context.data.dynamic.revision).toBe(before);
  expect(JSON.stringify(context)).not.toContain(ws);
  expect(cli('status', '--workspace', ws).data.revision).toBe(before);
  const invalid = spawnSync(
    process.execPath,
    [resolve('dist/bin.js'), 'agent-context', '--scenario', 'unknown', '--json'],
    { encoding: 'utf8' },
  );
  expect(JSON.parse(invalid.stdout).ok).toBe(false);
}, 30_000);
