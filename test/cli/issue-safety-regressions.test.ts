import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createDefaultExecutor, createPresentation } from '../../src/index.js';
import { OpcArchive } from '../../src/opc/index.js';
import { acquireWriteLock } from '../../src/workspace/lock.js';

const bin = resolve('dist/bin.js');
const cli = (...args: string[]) => {
  const { stdout, stderr } = spawnSync(process.execPath, [bin, ...args, '--json'], {
    encoding: 'utf8',
  });
  if (!stdout) throw new Error(stderr);
  return JSON.parse(stdout);
};

it('pins apply controls and rejects historical reads before returning live content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-controls-'));
  const a = join(root, 'a');
  const b = join(root, 'b');
  const ops = join(root, 'ops.json');
  for (const workspace of [a, b]) expect(cli('new', workspace, '--blank').ok).toBe(true);
  const op = { type: 'addSlide', name: 'Unexpected', workspaceId: b, dryRun: false };
  for (const input of [[op], [op, { type: 'addSlide', name: 'Other' }]]) {
    await writeFile(ops, JSON.stringify(input));
    expect(cli('apply', '--input', ops, '--workspace', a, '--dry-run')).toMatchObject({
      ok: true,
      revision: 1,
    });
  }
  expect(cli('apply', '--input', ops, '--workspace', a, '--expect-revision')).toMatchObject({
    ok: false,
  });
  for (const workspace of [a, b])
    expect(cli('status', '--workspace', workspace)).toMatchObject({ ok: true, revision: 1 });
  expect(cli('add', 'slide', '--name', 'New', '--workspace', a).ok).toBe(true);
  for (const args of [
    ['list', 'slides', '--revision', '1'],
    ['validate', '--revision', '999'],
  ])
    expect(cli(...args, '--workspace', a).error.code).toBe('UNSUPPORTED_CAPABILITY');
  expect(cli('validate', '--workspace', a, '--level', 'fast').error.code).toBe(
    'UNSUPPORTED_CAPABILITY',
  );
}, 30000);

it.each(['pptx', 'docx'])(
  'protects %s workspace files and reports incompatible manifests',
  async (format) => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-export-guard-'));
    const ws = join(root, 'ws');
    const meta = join(ws, '.deckuse', 'manifest.json');
    const alias = join(root, 'alias');
    expect(cli('new', ws, '--format', format).ok).toBe(true);
    await symlink(join(ws, 'source'), alias, 'dir');
    const before = await readFile(meta, 'utf8');
    for (const output of [meta, join(alias, 'deliverable.' + format)]) {
      expect(cli('export', output, '--workspace', ws, '--from-package').error.code).toBe(
        'INVALID_COMMAND',
      );
    }
    expect(await readFile(meta, 'utf8')).toBe(before);
    const valid = cli('validate', '--workspace', ws, '--render', '--package', '--relationships');
    expect(valid).toMatchObject({ ok: true, data: { renderPerformed: false } });
    expect(cli('export', join(ws, 'deliverable.' + format), '--workspace', ws).ok).toBe(true);
    const next = JSON.parse(await readFile(meta, 'utf8'));
    const write =
      format === 'pptx'
        ? ['add', 'slide', '--name', 'Write']
        : ['add', 'paragraph', '--text', 'Write'];
    for (const invalid of [{ schemaVersion: '1.0' }, { revision: 'wrong' }]) {
      const bytes = JSON.stringify({ ...next, ...invalid });
      await writeFile(meta, bytes);
      expect(cli('status', '--workspace', ws).data.compatible).toBe(false);
      expect(cli(...write, '--workspace', ws).error.code).toBe('UNSUPPORTED_VERSION');
      expect(cli('undo', '--workspace', ws).error.code).toBe('UNSUPPORTED_VERSION');
      expect(await readFile(meta, 'utf8')).toBe(bytes);
    }
  },
  30000,
);

it('uses a monotonic write guard across undo and paginates filtered history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-undo-revision-'));
  expect(cli('new', root, '--blank').ok).toBe(true);
  expect(cli('add', 'slide', '--name', 'Original', '--workspace', root).revision).toBe(2);
  expect(cli('undo', '--workspace', root).revision).toBe(1);
  expect(cli('add', 'slide', '--name', 'Different', '--workspace', root).revision).toBe(3);
  const write = [
    'add',
    'shape',
    '--slide',
    '1',
    '--type',
    'text',
    '--name',
    'OnlyOnSlide1',
    '--x',
    '0',
    '--y',
    '0',
    '--width',
    '914400',
    '--height',
    '457200',
    '--workspace',
    root,
  ];
  expect(cli(...write, '--expect-revision', '2').error.code).toBe('TRANSACTION_CONFLICT');
  expect(cli(...write, '--expect-revision', '3').revision).toBe(4);
  expect(cli('history', '--slide', '1', '--limit', '1', '--workspace', root).data).toMatchObject({
    total: 1,
    records: [{ revision: '4' }],
  });
  expect(
    cli('history', '--slide', '1', '--limit', '1', '--offset', '1', '--workspace', root).data,
  ).toMatchObject({
    total: 1,
    records: [],
  });
}, 30000);

it('rejects foreign and contradictory references, then refreshes the index on export', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-ref-'));
  const a = join(root, 'a');
  const b = join(root, 'b');
  const ops = join(root, 'ops.json');
  for (const workspace of [a, b]) {
    expect(cli('new', workspace, '--blank').ok).toBe(true);
    await writeFile(
      ops,
      JSON.stringify(
        ['IndexBefore', 'Other'].map((text) => ({
          type: 'addShape',
          shapeType: 'text',
          name: text,
          slide: 1,
          x: '0px',
          y: '0px',
          width: '100px',
          height: '40px',
          text,
        })),
      ),
    );
    expect(cli('apply', '--input', ops, '--workspace', workspace).ok).toBe(true);
  }
  const aRef = cli('query', 'text=IndexBefore', '--workspace', a).data.items[0].ref;
  const bRef = cli('query', 'text=IndexBefore', '--workspace', b).data.items[0].ref;
  const bOther = cli('query', 'text=Other', '--workspace', b).data.items[0].ref;
  for (const ref of [aRef, { ...bRef, path: bOther.path }]) {
    await writeFile(ops, JSON.stringify({ type: 'setText', ref, text: 'Wrong' }));
    expect(cli('apply', '--input', ops, '--workspace', b).error.code).toBe('ELEMENT_NOT_FOUND');
  }
  await writeFile(ops, JSON.stringify({ type: 'setText', ref: bRef, text: 'BeforeExport' }));
  expect(cli('apply', '--input', ops, '--workspace', b).ok).toBe(true);
  const part = join(b, 'source', bRef.path.split('#')[0]);
  const before = await readFile(part, 'utf8');
  await writeFile(part, before.replace('BeforeExport', 'AfterExport'));
  expect(cli('export', join(root, 'out.pptx'), '--workspace', b).ok).toBe(true);
  expect(cli('query', 'text=BeforeExport', '--workspace', b).data.total).toBe(0);
  expect(cli('query', 'text=AfterExport', '--workspace', b).data.total).toBe(1);
}, 30000);

it('validates DOCX selectors before changing source and parses string booleans', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-docx-selector-'));
  expect(cli('new', root, '--format', 'docx').ok).toBe(true);
  expect(cli('add', 'paragraph', '--text', 'Alpha', '--workspace', root).ok).toBe(true);
  const source = join(root, 'source', 'word', 'document.xml');
  const pack = join(root, 'package.docx');
  const bytes = await Promise.all([readFile(source), readFile(pack)]);
  expect(
    cli(
      'replace-text',
      '--workspace',
      root,
      '--source',
      'Alpha',
      '--target',
      'Beta',
      '--selector',
      'pagge=99',
    ).error.code,
  ).toBe('INVALID_COMMAND');
  expect(await Promise.all([readFile(source), readFile(pack)])).toEqual(bytes);
  expect(cli('status', '--workspace', root).revision).toBe(2);
  const executor = createDefaultExecutor();
  const object = await executor.execute({
    version: '2.0',
    type: 'query',
    workspaceId: root,
    selector: { kind: 'paragraph', hasText: false },
  });
  const string = await executor.execute({
    version: '2.0',
    type: 'query',
    workspaceId: root,
    selector: 'kind=paragraph hasText=false',
  });
  expect(string.ok).toBe(true);
  expect(string).toEqual(object);
}, 20000);

it.each(['pptx', 'docx'])(
  'rejects case-colliding %s parts before extracting either stream',
  async (format) => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-opc-case-'));
    const input = join(root, 'collision.' + format);
    const workspace = join(root, 'workspace');
    const archive = await OpcArchive.openFile(resolve('assets/default.' + format));
    archive.setPart('/audit/Blob.bin', Buffer.from('first'));
    archive.setPart('/audit/blob.bin', Buffer.from('second'));
    await archive.writeFile(input);
    const result = cli('init', input, workspace);
    expect(result.error.message).toContain('OPC extraction paths collide');
    const extracted = join(root, 'extracted');
    await mkdir(extracted);
    await expect(archive.writeDirectoryContents(extracted)).rejects.toThrow('paths collide');
    expect(await readdir(extracted)).toEqual([]);
  },
);

it('reports an existing workspace lock through a fresh resolver and recovers after release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-resolver-lock-'));
  expect((await createPresentation(root)).ok).toBe(true);
  const release = await acquireWriteLock(root);
  const executor = createDefaultExecutor();
  const command = { version: '2.0', type: 'status', workspaceId: root };
  const now = Date.now();
  const clock = vi
    .spyOn(Date, 'now')
    .mockReturnValueOnce(now)
    .mockReturnValueOnce(now)
    .mockReturnValueOnce(now)
    .mockReturnValue(now + 31000);
  try {
    expect(await executor.execute(command)).toMatchObject({
      ok: false,
      error: { code: 'TRANSACTION_CONFLICT', hint: expect.stringContaining('--read-only') },
    });
  } finally {
    clock.mockRestore();
    await release();
  }
  expect(await executor.execute(command)).toMatchObject({ ok: true, value: { revision: '1' } });
});

it('journals DOCX undo and rolls back failed writes with default cleanup and deletion denied', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-word-rollback-'));
  const ws = join(root, 'workspace');
  const hook = join(root, 'fault.mjs');
  const tracked = [
    'source/word/document.xml',
    'package.docx',
    '.deckuse/manifest.json',
    '.deckuse/operations.jsonl',
    '.git/refs/heads/main',
  ];
  await writeFile(
    hook,
    `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const { rm, rename } = fs;
    fs.rm = async (target, ...args) => {
      if (String(target).startsWith(process.env.ROUND_WORKSPACE + '/')) {
        process.stderr.write('Unexpected deletion: ' + target + '\\n');
        throw Object.assign(new Error('Delete denied'), { code: 'EACCES' });
      }
      return rm(target, ...args);
    };
    fs.rename = async (from, to) => {
      if (process.env.ROUND_FAIL_PACK === '1' && String(to) === process.env.ROUND_WORKSPACE + '/package.docx') {
        throw Object.assign(new Error('Snapshot publication failed'), { code: 'EIO' });
      }
      return rename(from, to);
    };
    syncBuiltinESMExports();
  `,
  );
  function managed(fail: boolean, ...args: string[]) {
    const env = { ...process.env };
    delete env.DECKUSE_CLEANUP_MODE;
    const { stdout, stderr } = spawnSync(
      process.execPath,
      ['--import', hook, bin, ...args, '--workspace', ws, '--json'],
      {
        encoding: 'utf8',
        env: { ...env, ROUND_WORKSPACE: ws, ROUND_FAIL_PACK: fail ? '1' : '0' },
      },
    );
    expect(stderr).not.toContain('Unexpected deletion');
    return JSON.parse(stdout);
  }
  expect(cli('new', ws, '--format', 'docx').ok).toBe(true);
  const committed = managed(false, 'add', 'paragraph', '--text', 'UndoCandidate');
  expect(committed).toMatchObject({
    ok: true,
    revision: 2,
    data: {
      cleanupRetirements: expect.arrayContaining([
        expect.objectContaining({ category: 'transaction' }),
        expect.objectContaining({ category: 'write.lock' }),
      ]),
    },
  });
  const retired = await readdir(join(ws, '.deckuse-trash'));
  expect(retired.some((name) => name.endsWith('-transaction'))).toBe(true);
  const readTracked = () => Promise.all(tracked.map((file) => readFile(join(ws, file))));
  const before = await readTracked();
  expect(managed(true, 'add', 'paragraph', '--text', 'Uncommitted').ok).toBe(false);
  expect(await readTracked()).toEqual(before);
  expect(managed(true, 'undo').ok).toBe(false);
  expect(await readTracked()).toEqual(before);
  expect(managed(false, 'status')).toMatchObject({
    ok: true,
    revision: 2,
    data: { packageStale: false },
  });
  const exportPath = join(root, 'export.docx');
  expect(managed(false, 'export', exportPath, '--from-package').ok).toBe(true);
  expect(
    (await OpcArchive.openFile(exportPath)).readXml('/word/document.xml').toString(),
  ).toContain('UndoCandidate');
  expect(managed(false, 'undo')).toMatchObject({ ok: true, revision: 1 });
}, 30000);
