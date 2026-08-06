import { describe, expect, it, vi } from 'vitest';
import {
  AdapterRegistry,
  Executor,
  createNotImplementedAdapter,
  ok,
  type FormatAdapter,
} from '../src/index.js';
describe('executor', () => {
  it('validates input before dispatch', async () => {
    const result = await new Executor(new AdapterRegistry()).execute({ type: 'validate' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_COMMAND');
  });
  it('binds initialized workspaces to adapters', async () => {
    const execute = vi.fn(async () => ok({ valid: true }));
    const adapter: FormatAdapter = {
      format: 'test',
      version: '1',
      async init(command) {
        return ok({
          schemaVersion: '1.0',
          workspaceId: command.workspaceId,
          format: 'test',
          source: command.source,
          revision: 'r1',
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          adapterVersion: '1',
          files: [],
        });
      },
      execute,
    };
    const executor = new Executor(new AdapterRegistry().register(adapter));
    expect(
      (
        await executor.execute({
          version: '1.0',
          type: 'init',
          workspaceId: 'w',
          format: 'test',
          source: 'a.test',
        })
      ).ok,
    ).toBe(true);
    expect(
      (await executor.execute({ version: '1.0', type: 'validate', workspaceId: 'w' })).ok,
    ).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('recovers an adapter through the persistent resolver', async () => {
    const execute = vi.fn(async () => ok({ recovered: true }));
    const adapter: FormatAdapter = {
      format: 'test',
      version: '1',
      async init() {
        throw new Error('not used');
      },
      execute,
    };
    const resolver = vi.fn(async () => adapter);
    const executor = new Executor(new AdapterRegistry(), { resolveAdapter: resolver });
    const result = await executor.execute({
      version: '1.0',
      type: 'validate',
      workspaceId: '/tmp/persistent-workspace',
    });
    expect(result.ok).toBe(true);
    expect(resolver).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });
  it('returns the placeholder error', async () => {
    const executor = new Executor(
      new AdapterRegistry().register(createNotImplementedAdapter('docx')),
    );
    const result = await executor.execute({
      version: '1.0',
      type: 'init',
      workspaceId: 'w',
      format: 'docx',
      source: 'a.docx',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORMAT_NOT_IMPLEMENTED');
  });
});
