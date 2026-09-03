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
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>',
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
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:cSld><p:spTree>
          <p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr>
            <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Hello</a:t></a:r></a:p></p:txBody>
          </p:sp>
        </p:spTree></p:cSld>
      </p:sld>`,
    ),
    'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  );
  archive.setRelationships('/ppt/slides/slide1.xml', [
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
      target: '../slideLayouts/slideLayout1.xml',
      external: false,
    },
  ]);
  archive.setPart(
    '/ppt/slideLayouts/slideLayout1.xml',
    encoder.encode(
      '<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>',
    ),
    'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  );
  archive.setRelationships('/ppt/slideLayouts/slideLayout1.xml', [
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
      target: '../slideMasters/slideMaster1.xml',
      external: false,
    },
  ]);
  archive.setPart(
    '/ppt/slideMasters/slideMaster1.xml',
    encoder.encode(
      `<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
        <p:txStyles>
          <p:titleStyle>
            <a:defPPr><a:defRPr sz="3200"><a:latin typeface="MasterTitle"/></a:defRPr></a:defPPr>
          </p:titleStyle>
          <p:bodyStyle><a:defPPr><a:defRPr sz="1800"/></a:defPPr></p:bodyStyle>
          <p:otherStyle><a:defPPr><a:defRPr sz="1200"/></a:defPPr></p:otherStyle>
        </p:txStyles>
      </p:sldMaster>`,
    ),
    'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  );
  archive.setRelationships('/ppt/slideMasters/slideMaster1.xml', [
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
      target: '../theme/theme1.xml',
      external: false,
    },
  ]);
  archive.setPart(
    '/ppt/theme/theme1.xml',
    encoder.encode(
      `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office">
        <a:themeElements>
          <a:clrScheme name="Office">
            <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
            <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
            <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
          </a:clrScheme>
          <a:fontScheme name="Office">
            <a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
            <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
          </a:fontScheme>
          <a:fmtScheme name="Office"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>
        </a:themeElements>
      </a:theme>`,
    ),
    'application/vnd.openxmlformats-officedocument.theme+xml',
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
  it('provides version and Phase 1a help', async () => {
    const version = await run(['-V']);
    expect(version).toMatchObject({ code: 0, stderr: '' });
    expect(version.stdout).toMatch(/^deckuse \d+\.\d+\.\d+\n$/);

    const help = await run(['--help']);
    expect(help).toMatchObject({ code: 0, stderr: '' });
    expect(help.stdout).toContain('deckuse [global-options]');
    expect(help.stdout).toContain('protocol 2.0');
    expect(help.stdout).toContain('--workspace');
  });
  it('runs init, list, get, set, validate, history, undo and export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-cli-')),
      source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    await fixture(source);
    const init = await run(['init', source, workspace, '--json']);
    expect(init.code).toBe(0);
    const initEnvelope = JSON.parse(init.stdout) as { ok: boolean; revision?: number };
    expect(initEnvelope.ok).toBe(true);
    expect(initEnvelope.revision).toBe(1);

    await expect(
      access(join(workspace, 'source', 'ppt', 'slides', 'slide1.xml')),
    ).resolves.toBeUndefined();

    const list = await run(['list', 'shapes', '--workspace', workspace, '--slide', '1', '--json']);
    expect(list.code).toBe(0);
    const listed = JSON.parse(list.stdout) as {
      ok: boolean;
      data: { items: Array<{ target: string }> };
    };
    expect(listed.ok).toBe(true);
    expect(listed.data.items.some((item) => item.target === 'slide:1/shape:2')).toBe(true);

    const got = await run([
      'get',
      'slide:1/shape:2',
      '--workspace',
      workspace,
      '--resolve',
      'both',
      '--json',
    ]);
    expect(got.code).toBe(0);
    const details = JSON.parse(got.stdout) as {
      ok: boolean;
      data: {
        properties: Record<string, { effective?: unknown; inherited?: boolean; source?: { scope?: string } }>;
      };
    };
    expect(details.ok).toBe(true);
    expect(details.data.properties['font.size']?.inherited).toBe(true);
    expect(details.data.properties['font.size']?.effective).toBe(32);
    expect(details.data.properties['font.size']?.source?.scope).toBe('master');
    expect(details.data.properties['text.value']?.effective).toBe('Hello');

    const set = await run([
      'set',
      'slide:1/shape:2',
      '--workspace',
      workspace,
      '--font.size',
      '42',
      '--json',
    ]);
    expect(set.code).toBe(0);
    const setEnvelope = JSON.parse(set.stdout) as { ok: boolean; revision?: number };
    expect(setEnvelope.revision).toBe(2);

    const gotAfter = await run([
      'get',
      'slide:1/shape:2',
      '--workspace',
      workspace,
      '--props',
      'font.size',
      '--json',
    ]);
    const after = JSON.parse(gotAfter.stdout) as {
      data: { properties: Record<string, { effective?: unknown; direct?: unknown; inherited?: boolean }> };
    };
    expect(after.data.properties['font.size']?.effective).toBe(42);
    expect(after.data.properties['font.size']?.inherited).toBe(false);

    expect((await run(['validate', '--workspace', workspace, '--json'])).code).toBe(0);
    expect((await run(['history', '--workspace', workspace, '--json'])).code).toBe(0);
    expect((await run(['undo', '--workspace', workspace, '--json'])).code).toBe(0);

    const exportPath = join(root, 'out.pptx');
    expect((await run(['export', exportPath, '--workspace', workspace, '--json'])).code).toBe(0);
    await expect(stat(exportPath)).resolves.toMatchObject({ size: expect.any(Number) });
  });
  it('supports replace-text with --source and --target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-cli-replace-')),
      source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    await fixture(source);
    expect((await run(['init', source, workspace, '--json'])).code).toBe(0);

    const replaced = await run([
      'replace-text',
      '--workspace',
      workspace,
      '--source',
      'Hello',
      '--target',
      'Bonjour',
      '--json',
    ]);
    expect(replaced.code).toBe(0);
    const envelope = JSON.parse(replaced.stdout) as { ok: boolean; revision?: number };
    expect(envelope.ok).toBe(true);
    expect(envelope.revision).toBe(2);

    const got = await run([
      'get',
      'slide:1/shape:2',
      '--workspace',
      workspace,
      '--props',
      'text.value',
      '--json',
    ]);
    const details = JSON.parse(got.stdout) as {
      data: { properties: Record<string, { effective?: unknown }> };
    };
    expect(details.data.properties['text.value']?.effective).toBe('Bonjour');
  });
  it('supports legacy apply JSON mutations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-cli-apply-')),
      source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    await fixture(source);
    expect((await run(['init', source, workspace, '--json'])).code).toBe(0);
    const apply = await run(
      ['apply', workspace, '--input', '-', '--json'],
      JSON.stringify({
        type: 'add',
        parent: { documentId: workspace, path: '/ppt/slides/slide1.xml' },
        element: { kind: 'textbox', text: 'CLI', name: 'CLI Box' },
      }),
    );
    expect(apply.code).toBe(0);
    const packaged = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    expect(new TextDecoder().decode(packaged.getPart('/ppt/slides/slide1.xml')!.data)).toContain(
      'CLI',
    );
    const manifest = JSON.parse(
      await readFile(join(workspace, '.deckuse', 'manifest.json'), 'utf8'),
    ) as { revision: string };
    expect(manifest.revision).toBe('2');
  });
});
