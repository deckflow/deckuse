import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
const fault = vi.hoisted(() => ({ phase: '', fired: false }));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  function trigger(phase: string) {
    if (fault.phase === phase && !fault.fired) {
      fault.fired = true;
      throw new Error(`Injected ${phase}`);
    }
  }
  return {
    ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      const target = String(args[1]);
      if (target.endsWith('/source')) trigger('source');
      if (target.endsWith('/package.pptx') || target.endsWith('/package.docx')) trigger('package');
      if (target.endsWith('/manifest.json')) trigger('metadata');
      return fs.rename(...args);
    },
    writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
      if (String(args[0]).endsWith('/operations.jsonl')) trigger('log');
      return fs.writeFile(...args);
    },
  };
});
import { runCommand } from '../../src/index.js';

describe('persistence phase failures', () => {
  it.each(['source', 'package', 'metadata', 'log'])('rolls back the %s phase', async (phase) => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-phase-fault-'));
    const base = { version: '2.0', workspaceId: root };
    fault.phase = '';
    fault.fired = false;
    expect(
      (
        await runCommand({
          ...base,
          type: 'init',
          format: 'pptx',
          source: resolve('assets/default.pptx'),
        })
      ).ok,
    ).toBe(true);
    const files = [
      'source/ppt/slides/slide1.xml',
      'package.pptx',
      '.deckuse/manifest.json',
      '.deckuse/index.json',
      '.deckuse/operations.jsonl',
      '.git/index',
      '.git/refs/heads/main',
    ];
    const before = await Promise.all(files.map((p) => readFile(join(root, p))));
    fault.phase = phase;
    const result = await runCommand({
      ...base,
      type: 'addSlide',
      transactionId: '1',
      layout: 'Blank',
    });
    fault.phase = '';
    expect(fault.fired).toBe(true);
    expect(result.ok).toBe(false);
    const after = await Promise.all(files.map((p) => readFile(join(root, p))));
    expect(after).toEqual(before);
  });
});
