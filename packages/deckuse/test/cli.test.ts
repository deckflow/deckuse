import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OpcArchive } from '@deckflow/deckuse-opc';
const encoder = new TextEncoder();
async function fixture(path: string) {
  const archive = new OpcArchive();
  archive.setPart(
    '/[Content_Types].xml',
    encoder.encode(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    ),
    'application/xml',
  );
  archive.setPart(
    '/ppt/presentation.xml',
    encoder.encode(
      '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    ),
    'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  );
  archive.setRelationships('/ppt/presentation.xml', [
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
      target: 'slides/slide1.xml',
      external: false,
    },
  ]);
  archive.setPart(
    '/ppt/slides/slide1.xml',
    encoder.encode(
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>',
    ),
    'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  );
  await archive.writeFile(path);
}
const run = (
  args: string[],
  stdin = '',
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((done) => {
    const child = spawn(process.execPath, [resolve('packages/deckuse/dist/bin.js'), ...args], {
      cwd: resolve('.'),
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('close', (code) => done({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
describe('deckuse CLI', () => {
  it('provides version and progressive command help', async () => {
    const version = await run(['-V']);
    expect(version).toMatchObject({ code: 0, stderr: '' });
    expect(version.stdout).toMatch(/^deckuse \d+\.\d+\.\d+\n$/);

    const help = await run(['--help']);
    expect(help).toMatchObject({ code: 0, stderr: '' });
    expect(help.stdout).toContain('usage: deckuse <command>');
    expect(help.stdout).toContain('deckuse <command> --help');
    expect(help.stdout).toContain('undo <workspace>');
    expect(help.stdout).toContain('history <workspace>');
    expect(help.stdout).toContain('monitor <workspace>');

    const undoHelp = await run(['undo', '--help']);
    expect(undoHelp).toMatchObject({ code: 0, stderr: '' });
    expect(undoHelp.stdout).toContain('usage: deckuse undo <workspace>');
    expect(undoHelp.stdout).toContain('--steps');

    const monitorHelp = await run(['monitor', '--help']);
    expect(monitorHelp).toMatchObject({ code: 0, stderr: '' });
    expect(monitorHelp.stdout).toContain('usage: deckuse monitor <workspace>');
    expect(monitorHelp.stdout).toContain('--host');
    expect(monitorHelp.stdout).toContain('--port');

    const invalidMonitor = await run(['monitor', '.', '--port', 'invalid']);
    expect(invalidMonitor.code).toBe(2);
    expect(invalidMonitor.stderr).toContain('--port must be an integer');

    const invalidWorkspace = await mkdtemp(join(tmpdir(), 'deckuse-cli-invalid-monitor-'));
    const missingWorkspace = await run(['monitor', invalidWorkspace, '--port', '0']);
    expect(missingWorkspace.code).toBe(2);
    expect(missingWorkspace.stderr).toContain('Invalid deckuse workspace');

    const helpAlias = await run(['help', 'apply']);
    expect(helpAlias).toMatchObject({ code: 0, stderr: '' });
    expect(helpAlias.stdout).toContain('usage: deckuse apply <workspace>');
  });
  it('runs init, inspect, apply, validate, history, undo and auto package export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-cli-')),
      source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    await fixture(source);
    expect((await run(['init', source, workspace, '--json'])).code).toBe(0);
    await expect(
      access(join(workspace, 'source', 'ppt', 'slides', 'slide1.xml')),
    ).resolves.toBeUndefined();
    await expect(readFile(join(workspace, '.gitignore'), 'utf8')).resolves.toContain('package.*');
    const inspect = await run(['inspect', workspace, '--json']);
    expect(inspect.code).toBe(0);
    expect(JSON.parse(inspect.stdout) as { ok: boolean }).toMatchObject({ ok: true });
    const apply = await run(
      ['apply', workspace, '--input', '-', '--json'],
      JSON.stringify({
        type: 'add',
        parent: { documentId: workspace, path: '/ppt/slides/slide1.xml' },
        element: { kind: 'textbox', text: 'CLI' },
      }),
    );
    expect(apply.code).toBe(0);
    expect((await run(['validate', workspace, '--json'])).code).toBe(0);
    const packaged = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    expect(new TextDecoder().decode(packaged.getPart('/ppt/slides/slide1.xml')!.data)).toContain(
      'CLI',
    );
    const history = await run(['history', workspace, '--json']);
    expect(history.code).toBe(0);
    const historyValue = JSON.parse(history.stdout) as {
      ok: boolean;
      value: { total: number; records: Array<{ slides: number[]; operation: { type: string } }> };
    };
    expect(historyValue).toMatchObject({ ok: true });
    expect(historyValue.value.total).toBe(1);
    expect(historyValue.value.records[0]?.operation.type).toBe('add');
    expect(historyValue.value.records[0]?.slides).toEqual([1]);
    const undo = await run(['undo', workspace, '--json']);
    expect(undo.code).toBe(0);
    const afterUndo = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    expect(
      new TextDecoder().decode(afterUndo.getPart('/ppt/slides/slide1.xml')!.data),
    ).not.toContain('CLI');
    const historyAfterUndo = JSON.parse((await run(['history', workspace, '--json'])).stdout) as {
      value: { total: number };
    };
    expect(historyAfterUndo.value.total).toBe(0);
    await expect(stat(join(workspace, 'package.pptx'))).resolves.toMatchObject({
      size: expect.any(Number),
    });
  });
});
