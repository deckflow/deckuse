import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('machine readable CLI discovery and errors', () => {
  it.each([
    ['export'],
    ['schema', '--type', 'DOES_NOT_EXIST'],
    ['schema', '--command', 'add'],
    ['DOES_NOT_EXIST'],
    [
      'apply',
      '--workspace',
      '/nonexistent-deckuse-test',
      '--input',
      '/nonexistent-deckuse-test.json',
    ],
  ])('returns an error envelope for %j', (...args) => {
    const result = spawnSync(process.execPath, ['dist/bin.js', ...args, '--json'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });
  it('lists addSlide as batchable', () => {
    const result = spawnSync(process.execPath, ['dist/bin.js', 'schema', '--list', '--json'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data.batchTypes).toContain('addSlide');
  });
  it('returns only reachable schema definitions with valid local references', () => {
    const invoke = (args: string[]) =>
      JSON.parse(
        spawnSync(process.execPath, ['dist/bin.js', 'schema', ...args, '--json'], {
          encoding: 'utf8',
        }).stdout,
      ).data.schema;
    const full = invoke([]),
      subset = invoke(['--type', 'addSlide']);
    expect(Object.keys(subset.$defs).length).toBeLessThan(Object.keys(full.$defs).length);
    const walk = (value: any): void => {
      if (!value || typeof value !== 'object') return;
      if (value.$ref) expect(subset.$defs[value.$ref.slice(8)]).toBeDefined();
      Object.values(value).forEach(walk);
    };
    walk(subset);
  });
});
