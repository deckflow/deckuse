import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
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
  it('runs human init, inspect, apply, validate and commit commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-cli-')),
      source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace'),
      output = join(root, 'output.pptx');
    await fixture(source);
    expect((await run(['init', source, workspace, '--json'])).code).toBe(0);
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
    expect((await run(['commit', workspace, '-o', output, '--json'])).code).toBe(0);
    expect((await readFile(output)).length).toBeGreaterThan(0);
    expect((await run(['commit', workspace, '-o', output, '--json'])).code).toBe(1);
    expect((await run(['commit', workspace, '-o', output, '--force', '--json'])).code).toBe(0);
  });
});
