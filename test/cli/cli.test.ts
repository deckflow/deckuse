import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OpcArchive } from '../../src/opc/index.js';
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
    const child = spawn(process.execPath, [resolve('dist/bin.js'), ...args], {
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
    expect(version.stdout).toMatch(/^deckuse \d+\.\d+\.\d+( \(edition=\w+\))?\n$/);

    const help = await run(['--help']);
    expect(help).toMatchObject({ code: 0, stderr: '' });
    expect(help.stdout).toContain('deckuse [global-options]');
    expect(help.stdout).toContain('protocol 2.0');
    expect(help.stdout).toContain('--workspace');
    expect(help.stdout).toContain('add           Add a slide, shape, paragraph, or table');
    expect(help.stdout).toContain(
      'new           Create a workspace from the bundled blank template',
    );
    expect(help.stdout).toContain('render        Screenshot one slide to PNG');
  });

  it('provides progressive command and subcommand help', async () => {
    const add = await run(['add', '--help']);
    expect(add).toMatchObject({ code: 0, stderr: '' });
    expect(add.stdout).toContain('usage: deckuse add <slide|shape|paragraph|table|break>');
    expect(add.stdout).toContain('Add a slide, shape, paragraph, table, or page break');
    expect(add.stdout).toContain('Example:');
    expect(add.stdout).toContain('deckuse add shape --slide 1 --type text');
    expect(add.stdout).toContain('Subcommands:');

    const newHelp = await run(['new', '--help']);
    expect(newHelp).toMatchObject({ code: 0, stderr: '' });
    expect(newHelp.stdout).toContain('usage: deckuse new <workspace/>');
    expect(newHelp.stdout).toContain('bundled blank');
    expect(newHelp.stdout).toContain('assets/default.pptx');

    const addShape = await run(['add', 'shape', '--help']);
    expect(addShape).toMatchObject({ code: 0, stderr: '' });
    expect(addShape.stdout).toContain('usage: deckuse add shape --slide <n> --type <kind>');
    expect(addShape.stdout).toContain('--slide <n>');
    expect(addShape.stdout).toContain('--type <kind>');
    expect(addShape.stdout).toContain('rounded-rect');
    expect(addShape.stdout).toContain('table | chart | video | audio');
    expect(addShape.stdout).toContain('--rows <json>');
    expect(addShape.stdout).toContain('--chart-type <kind>');
    expect(addShape.stdout).toContain('--data <json>');
    expect(addShape.stdout).toContain('--text <text>');

    const setText = await run(['help', 'set', 'text']);
    expect(setText).toMatchObject({ code: 0, stderr: '' });
    expect(setText.stdout).toContain('usage: deckuse set text <target>');
    expect(setText.stdout).toContain('--value <text>');

    const nested = await run(['xfrm', 'set', '--slide', '1', '-h']);
    expect(nested).toMatchObject({ code: 0, stderr: '' });
    expect(nested.stdout).toContain('usage: deckuse xfrm set');
    expect(nested.stdout).toContain('--rotation <deg>');

    const renderHelp = await run(['render', '--help']);
    expect(renderHelp).toMatchObject({ code: 0, stderr: '' });
    expect(renderHelp.stdout).toContain('usage: deckuse render --page <n>');
    expect(renderHelp.stdout).toContain('--page <n>');
    expect(renderHelp.stdout).toContain('office2html');

    const monitorHelp = await run(['monitor', '--help']);
    expect(monitorHelp).toMatchObject({ code: 0, stderr: '' });
    expect(monitorHelp.stdout).toContain('usage: deckuse monitor');
    expect(monitorHelp.stdout).toContain('list all running daemons');
    expect(monitorHelp.stdout).toContain('--all');
  });

  it('monitor status without workspace lists daemons instead of requiring a workspace', async () => {
    const home = await mkdtemp(join(tmpdir(), 'deckuse-cli-home-'));
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (done) => {
        const child = spawn(
          process.execPath,
          [resolve('dist/bin.js'), 'monitor', 'status', '--json'],
          {
            cwd: tmpdir(),
            env: { ...process.env, DECKUSE_HOME: home },
          },
        );
        let stdout = '',
          stderr = '';
        child.stdout.on('data', (chunk) => (stdout += String(chunk)));
        child.stderr.on('data', (chunk) => (stderr += String(chunk)));
        child.on('close', (code) => done({ code, stdout, stderr }));
      },
    );
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    const envelope = JSON.parse(result.stdout) as {
      ok: boolean;
      data: { monitors: unknown[] };
    };
    expect(envelope.ok).toBe(true);
    expect(Array.isArray(envelope.data.monitors)).toBe(true);
    expect(result.stdout).not.toContain('No deckuse workspace found');
  });

  it('monitor stop without workspace errors with guidance', async () => {
    const home = await mkdtemp(join(tmpdir(), 'deckuse-cli-home-'));
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (done) => {
        const child = spawn(
          process.execPath,
          [resolve('dist/bin.js'), 'monitor', 'stop', '--json'],
          {
            cwd: tmpdir(),
            env: { ...process.env, DECKUSE_HOME: home },
          },
        );
        let stdout = '',
          stderr = '';
        child.stdout.on('data', (chunk) => (stdout += String(chunk)));
        child.stderr.on('data', (chunk) => (stderr += String(chunk)));
        child.on('close', (code) => done({ code, stdout, stderr }));
      },
    );
    expect(result.code).toBe(1);
    const envelope = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string; message: string };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('INVALID_COMMAND');
    expect(envelope.error?.message).toContain('--all');
    expect(envelope.error?.message).toContain('monitor status');
  });

  it('creates a workspace from the bundled blank template via new', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-cli-new-'));
    const workspace = join(root, 'workspace');
    const missing = await run(['new', '--json']);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('Usage: deckuse new <workspace/>');

    const created = await run(['new', workspace, '--json']);
    expect(created.code).toBe(0);
    const envelope = JSON.parse(created.stdout) as {
      ok: boolean;
      command?: string;
      revision?: number;
      data?: { source?: string; format?: string };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('deckuse new');
    expect(envelope.revision).toBe(1);
    expect(envelope.data?.format).toBe('pptx');
    expect(envelope.data?.source).toContain(join('assets', 'default.pptx'));

    await expect(
      access(join(workspace, 'source', 'ppt', 'slides', 'slide1.xml')),
    ).resolves.toBeUndefined();
    await expect(access(join(workspace, 'package.pptx'))).resolves.toBeUndefined();
  });

  it('creates a DOCX workspace from the bundled blank template', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-cli-docx-'));
    const workspace = join(root, 'workspace');
    const created = await run(['new', workspace, '--format', 'docx', '--json']);
    expect(created.code).toBe(0);
    const envelope = JSON.parse(created.stdout) as {
      ok: boolean;
      data?: { format?: string; elementCount?: number };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data?.format).toBe('docx');
    await expect(
      access(join(workspace, 'source', 'word', 'document.xml')),
    ).resolves.toBeUndefined();
    await expect(access(join(workspace, 'package.docx'))).resolves.toBeUndefined();
    const listed = await run(['list', 'paragraphs', '--workspace', workspace, '--json']);
    expect(listed.code).toBe(0);
    const listEnvelope = JSON.parse(listed.stdout) as {
      ok: boolean;
      data?: { items?: { target?: string }[] };
    };
    expect(listEnvelope.ok).toBe(true);
    expect(listEnvelope.data?.items?.[0]?.target).toBe('body/p:1');
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
        properties: Record<
          string,
          { effective?: unknown; inherited?: boolean; source?: { scope?: string } }
        >;
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
      data: {
        properties: Record<string, { effective?: unknown; direct?: unknown; inherited?: boolean }>;
      };
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
  it('query --workspace and positional workspace use the same selector', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-cli-query-')),
      source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    await fixture(source);
    expect((await run(['init', source, workspace, '--json'])).code).toBe(0);

    const viaFlag = await run(['query', '--workspace', workspace, 'text=Hello', '--json']);
    const viaPos = await run(['query', workspace, 'text=Hello', '--json']);
    expect(viaFlag.code, viaFlag.stderr || viaFlag.stdout).toBe(0);
    expect(viaPos.code, viaPos.stderr || viaPos.stdout).toBe(0);
    const flagData = JSON.parse(viaFlag.stdout) as {
      data: { items: unknown[]; total: number; truncated: boolean };
    };
    const posData = JSON.parse(viaPos.stdout) as {
      data: { items: unknown[]; total: number; truncated: boolean };
    };
    expect(flagData.data.items.length).toBe(posData.data.items.length);
    expect(flagData.data.total).toBe(posData.data.total);
    expect(flagData.data.truncated).toBe(false);
    expect(flagData.data.items.length).toBeGreaterThan(0);
    expect(flagData.data.items.length).toBeLessThan(20);

    const repeatedFlag = await run([
      'query',
      '--workspace',
      workspace,
      workspace,
      'text=Hello',
      '--json',
    ]);
    const repeatedPos = await run(['query', workspace, workspace, 'text=Hello', '--json']);
    expect(repeatedFlag.code, repeatedFlag.stderr || repeatedFlag.stdout).toBe(0);
    expect(repeatedPos.code, repeatedPos.stderr || repeatedPos.stdout).toBe(0);
    const repeatedFlagData = JSON.parse(repeatedFlag.stdout) as {
      data: { items: unknown[]; total: number };
    };
    const repeatedPosData = JSON.parse(repeatedPos.stdout) as {
      data: { items: unknown[]; total: number };
    };
    expect(repeatedFlagData.data.total).toBe(flagData.data.total);
    expect(repeatedPosData.data.items.length).toBe(flagData.data.items.length);

    const other = join(root, 'other-workspace');
    await mkdir(other);
    const conflict = await run(['query', '--workspace', workspace, other, 'text=Hello', '--json']);
    expect(conflict.code).not.toBe(0);
    const conflictBody = JSON.parse(conflict.stdout) as {
      ok: boolean;
      error?: { code?: string };
    };
    expect(conflictBody.ok).toBe(false);
    expect(conflictBody.error?.code).toBe('CONFLICTING_WORKSPACE');

    const limited = await run(['query', '--workspace', workspace, '--limit', '1', '--json']);
    expect(limited.code, limited.stderr || limited.stdout).toBe(0);
    const limitedData = JSON.parse(limited.stdout) as {
      data: { items: unknown[]; total: number; truncated: boolean };
    };
    expect(limitedData.data.items).toHaveLength(1);
    expect(limitedData.data.total).toBeGreaterThan(1);
    expect(limitedData.data.truncated).toBe(true);
  });

  it('apply accepts a top-level setTableLayout command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-cli-stl-')),
      source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    // Minimal table slide for setTableLayout.
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
        '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
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
        `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="2000000"/></a:tblGrid><a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr><a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>B</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
      ),
      'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
    );
    archive.setRelationships('/ppt/slides/slide1.xml', []);
    archive.setPart(
      '/docProps/app.xml',
      encoder.encode(
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>1</Slides></Properties>',
      ),
      'application/vnd.openxmlformats-officedocument.extended-properties+xml',
    );
    await archive.writeFile(source);
    expect((await run(['init', source, workspace, '--json'])).code).toBe(0);

    const apply = await run(
      ['apply', workspace, '--input', '-', '--json'],
      JSON.stringify({
        type: 'setTableLayout',
        target: 'slide:1/shape:3',
        redistribute: 'equal',
        height: 900000,
      }),
    );
    expect(apply.code, apply.stderr || apply.stdout).toBe(0);
    const envelope = JSON.parse(apply.stdout) as { ok: boolean };
    expect(envelope.ok).toBe(true);
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

  it('treats { operations: high-level writes } as batch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-cli-ops-')),
      source = join(root, 'source.pptx'),
      workspace = join(root, 'workspace');
    await fixture(source);
    expect((await run(['init', source, workspace, '--json'])).code).toBe(0);
    const apply = await run(
      ['apply', workspace, '--input', '-', '--json'],
      JSON.stringify({
        operations: [
          {
            type: 'addShape',
            slide: 1,
            shapeType: 'rect',
            name: 'OpsCard',
            x: '5%',
            y: '100px',
            width: '30%',
            height: '80px',
            fill: { color: 'F3F4F6' },
            blocks: [{ text: 'Ops', fontSize: 14, bold: true, textColor: '111827' }],
          },
          {
            type: 'setProperties',
            target: 'slide:1/shape:OpsCard',
            properties: { stroke: { color: 'E5E7EB', width: 1 } },
          },
        ],
      }),
    );
    expect(apply.code, apply.stderr || apply.stdout).toBe(0);
    const packaged = await OpcArchive.openFile(join(workspace, 'package.pptx'));
    const xml = new TextDecoder().decode(packaged.getPart('/ppt/slides/slide1.xml')!.data);
    expect(xml).toContain('OpsCard');
    expect(xml).toContain('F3F4F6');
    expect(xml).toContain('Ops');
  });

  it('rejects render without a single page', async () => {
    const missing = await run(['render', '--workspace', '/tmp']);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('Usage: deckuse render --page');

    const range = await run(['render', '--page', '1-3', '--workspace', '/tmp']);
    expect(range.code).toBe(2);
    expect(range.stderr).toContain('exactly one positive integer');
  });
});
