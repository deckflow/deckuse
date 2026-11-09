import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { OpcArchive } from '../../src/opc/index.js';
import { pptxAdapter } from '../../src/pptx/adapter.js';
import { docxAdapter } from '../../src/docx/adapter.js';
import { assertDefaultPptxExists, assertDefaultDocxExists } from '../../src/default-template.js';
import { PROTOCOL_VERSION } from '../../src/core/index.js';
import { withInitialization, WorkspaceNotEmptyError } from '../../src/workspace/initialize.js';

describe('workspace initialization reservation', () => {
  it('preserves an existing destination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-init-test-'));
    await writeFile(join(root, 'keep'), 'user content');
    await expect(withInitialization(root, async () => undefined)).rejects.toBeInstanceOf(
      WorkspaceNotEmptyError,
    );
    expect(await readFile(join(root, 'keep'), 'utf8')).toBe('user content');
  });
  it('cleans its own failed initialization and permits retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-init-test-'));
    await expect(
      withInitialization(root, async (_destination, reserve) => {
        await writeFile(await reserve('partial', 'file'), 'partial');
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(await readdir(root)).toEqual([]);
    await expect(withInitialization(root, async () => 'ok')).resolves.toBe('ok');
  });
  it('does not delete unrelated files created during initialization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-init-test-'));
    await expect(
      withInitialization(root, async (_destination, reserve) => {
        await writeFile(await reserve('partial', 'file'), 'owned');
        await writeFile(join(root, 'user-file'), 'keep');
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(await readdir(root)).toEqual(['user-file']);
    expect(await readFile(join(root, 'user-file'), 'utf8')).toBe('keep');
  });
  it('writes directly to the final directory without staging directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-init-test-'));
    const result = await withInitialization(root, async (destination, reserve) => {
      expect(destination).toBe(root);
      const source = await reserve('source', 'directory');
      await writeFile(join(source, 'document.xml'), '<document/>');
      expect(await readFile(join(root, 'source', 'document.xml'), 'utf8')).toBe('<document/>');
      expect((await readdir(root)).sort()).toEqual(['.deckuse-init.lock', 'source']);
      return 'created';
    });
    expect(result).toBe('created');
    expect(await readdir(root)).toEqual(['source']);
  });
  it('removes partially written directories on failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-init-test-'));
    await expect(
      withInitialization(root, async (_destination, reserve) => {
        const source = await reserve('source', 'directory');
        await writeFile(join(source, 'document.xml'), 'partial');
        await reserve('package.docx', 'file');
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(await readdir(root)).toEqual([]);
  });
  it('preserves a conflicting entry created before reservation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-init-test-'));
    await expect(
      withInitialization(root, async (_destination, reserve) => {
        await reserve('source', 'directory');
        await writeFile(join(root, 'package.docx'), 'user content');
        await reserve('package.docx', 'file');
      }),
    ).rejects.toBeInstanceOf(WorkspaceNotEmptyError);
    expect(await readdir(root)).toEqual(['package.docx']);
    expect(await readFile(join(root, 'package.docx'), 'utf8')).toBe('user content');
  });
  it('allows only one concurrent initializer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-init-test-'));
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withInitialization(root, async (_destination, reserve) => {
      entered();
      await gate;
      await writeFile(await reserve('result', 'file'), 'first');
    });
    await ready;
    await expect(withInitialization(root, async () => undefined)).rejects.toBeInstanceOf(
      WorkspaceNotEmptyError,
    );
    release();
    await first;
    expect(await readFile(join(root, 'result'), 'utf8')).toBe('first');
  });
});

describe('direct workspace initialization rollback', () => {
  it.each([
    { format: 'pptx', adapter: pptxAdapter, template: assertDefaultPptxExists },
    { format: 'docx', adapter: docxAdapter, template: assertDefaultDocxExists },
  ])('cleans failed $format packaging and permits retry', async ({ format, adapter, template }) => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-init-test-'));
    const command = {
      version: PROTOCOL_VERSION,
      type: 'init' as const,
      workspaceId: root,
      format,
      source: await template(),
    };
    const pack = vi.spyOn(OpcArchive.prototype, 'toUint8Array').mockImplementationOnce(async () => {
      expect(await readdir(join(root, 'source'))).not.toHaveLength(0);
      await writeFile(join(root, 'user-file'), 'keep');
      throw new Error('injected packaging failure');
    });
    try {
      const failed = await adapter.init(command);
      expect(failed.ok).toBe(false);
      expect(await readdir(root)).toEqual(['user-file']);
      expect(await readFile(join(root, 'user-file'), 'utf8')).toBe('keep');
    } finally {
      pack.mockRestore();
    }
    await rm(join(root, 'user-file'));
    expect((await adapter.init(command)).ok).toBe(true);
    expect((await readdir(root)).sort()).toEqual([
      '.deckuse',
      '.git',
      '.gitignore',
      `package.${format}`,
      'source',
    ]);
    expect(await readFile(join(root, '.git', 'HEAD'), 'utf8')).toContain('refs/heads/main');
  });
});

it('retires only reserved paths and the marker when initialization rolls back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deckuse-init-retire-'));
  vi.stubEnv('DECKUSE_CLEANUP_MODE', 'retire');
  try {
    await expect(
      withInitialization(root, async (_destination, reserve) => {
        await writeFile(await reserve('partial', 'file'), 'owned');
        await writeFile(join(root, 'user-file'), 'keep');
        throw new Error('injected failure');
      }),
    ).rejects.toThrow('injected failure');
    const trash = join(root, '.deckuse-trash');
    const entries = await readdir(trash);
    expect(entries).toHaveLength(2);
    const retired = entries.find((name) => name.endsWith('-partial'));
    expect(retired).toBeDefined();
    expect(await readFile(join(trash, retired!), 'utf8')).toBe('owned');
    expect(await readFile(join(root, 'user-file'), 'utf8')).toBe('keep');
    expect(await readdir(root)).toEqual(['.deckuse-trash', 'user-file']);
  } finally {
    vi.unstubAllEnvs();
  }
});
