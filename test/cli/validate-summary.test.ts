import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
it('reports presentation order, editable targets and honest layout states; preserves reports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-summary-'));
  const ws = join(root, 'ws');
  const cli = (...args: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, [resolve('dist/bin.js'), ...args, '--json'], {
        encoding: 'utf8',
      }),
    );
  cli('new', ws, '--blank');
  const ops = join(root, 'ops.json');
  await writeFile(
    ops,
    JSON.stringify([
      { type: 'addSlide', name: '第二页', layout: 'Blank' },
      { type: 'addSlide', name: '第一页', layout: 'Blank' },
      { type: 'remove', target: 'slide:1' },
      {
        type: 'addShape',
        slide: '第一页',
        shapeType: 'text',
        name: 'Title',
        x: '10px',
        y: '10px',
        width: '200px',
        height: '5px',
        blocks: [{ text: '中文密集标题 mixed typography', fontSize: 32 }],
      },
    ]),
  );
  cli(
    'apply',
    '--workspace',
    ws,
    '--input',
    ops,
    '--request-id',
    'create',
    '--expect-revision',
    '1',
  );
  const report = join(root, 'validation.json');
  const result = cli('validate', '--workspace', ws, '--summary', '--render', '--report', report);
  const inspection = result.data.inspection;
  expect(inspection.slides.map((s: any) => s.name)).toEqual(['第二页', '第一页']);
  expect(inspection.slides[1]).toMatchObject({ page: 2, target: 'slide:2', objectCount: 1 });
  expect(inspection.slides[1].partUri).not.toBe('/ppt/slides/slide2.xml');
  expect(inspection.slides[1].text[0].text).toContain('中文');
  expect(inspection.slides[1].text[0].target).toMatch(/^slide:2\/shape:/);
  expect(inspection.packageSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(inspection.layout.state).toBe('heuristic-only');
  expect(inspection.layout.diagnostics.length).toBeGreaterThan(0);
  expect(inspection.verification).toMatchObject({
    structure: 'valid',
    preview: 'not-performed',
    visualReview: 'not-performed',
  });
  const original = await readFile(report, 'utf8');
  expect(JSON.parse(original).data.chartData).toBeDefined();
  expect(cli('validate', '--workspace', ws).data.inspection).toBeUndefined();
  const duplicate = spawnSync(
    process.execPath,
    [
      resolve('dist/bin.js'),
      'validate',
      '--workspace',
      ws,
      '--summary',
      '--report',
      report,
      '--json',
    ],
    { encoding: 'utf8' },
  );
  expect(duplicate.status).toBe(1);
  expect(JSON.parse(duplicate.stdout).data.reportFailed).toBe(true);
  expect(await readFile(report, 'utf8')).toBe(original);
}, 30000);
