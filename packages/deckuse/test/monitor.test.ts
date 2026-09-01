import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { startMonitor } from '../src/monitor.js';

const eventually = async (assertion: () => void): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 49) throw error;
      await new Promise((done) => setTimeout(done, 10));
    }
  }
};

const subscribe = (url: string): Promise<{ close(): void; events: string[] }> =>
  new Promise((resolve, reject) => {
    const events: string[] = [];
    const subscriber = request(`${url}events`);
    subscriber.on('response', (response) => {
      response.on('data', (chunk) => events.push(String(chunk)));
      resolve({ close: () => subscriber.destroy(), events });
    });
    subscriber.on('error', reject);
    subscriber.end();
  });

const workspaceFixture = async (): Promise<string> => {
  const workspace = await mkdtemp(join(tmpdir(), 'deckuse-monitor-'));
  await mkdir(join(workspace, '.deckuse'));
  await writeFile(join(workspace, 'package.pptx'), 'pptx');
  await writeFile(join(workspace, '.gitignore'), 'package.*\n.deckuse/write.lock\n');
  await writeFile(
    join(workspace, '.deckuse', 'index.json'),
    JSON.stringify({
      revision: 'initial',
      elements: [{ kind: 'slide' }, { kind: 'textbox' }, { kind: 'slide' }],
    }),
  );
  await writeFile(join(workspace, '.deckuse', 'operations.jsonl'), '');
  return workspace;
};

describe('monitor', () => {
  it('refreshes ignore rules for existing workspaces before creating output', async () => {
    const workspace = await workspaceFixture();
    const monitor = await startMonitor(workspace, { port: 0 });
    await expect(readFile(join(workspace, '.gitignore'), 'utf8')).resolves.toContain(
      '.deckuse/monitor/',
    );
    await monitor.close();
  });

  it('is lazy, shares one watcher, coalesces conversions, and stops on last disconnect', async () => {
    const workspace = await workspaceFixture();
    const watcher = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> };
    watcher.close = vi.fn();
    let onChange: (() => void) | undefined;
    const watchFactory = vi.fn((_path: string, listener: () => void) => {
      onChange = listener;
      return watcher;
    });
    const conversions: Array<{
      page: string | undefined;
      finish: () => Promise<void>;
    }> = [];
    const converter = vi.fn((_input: string, options: { output: string; pages?: string }) => {
      let finish!: () => Promise<void>;
      const promise = new Promise<{
        indexHtmlPath: string;
        exitCode: number;
        stdout: string;
        stderr: string;
      }>((resolve) => {
        finish = async () => {
          await writeFile(
            join(options.output, 'index.html'),
            '<html><script src="asset.js"></script></html>',
          );
          await writeFile(join(options.output, 'asset.js'), 'ok');
          resolve({
            indexHtmlPath: join(options.output, 'index.html'),
            exitCode: 0,
            stdout: '',
            stderr: '',
          });
        };
      });
      conversions.push({ page: options.pages, finish });
      return promise;
    });
    const monitor = await startMonitor(workspace, {
      port: 0,
      dependencies: { convert: converter, watch: watchFactory, debounceMs: 1, keepaliveMs: 10_000 },
    });

    expect(watchFactory).not.toHaveBeenCalled();
    expect(converter).not.toHaveBeenCalled();
    const first = await subscribe(monitor.url);
    await eventually(() => expect(converter).toHaveBeenCalledTimes(1));
    expect(conversions[0]?.page).toBe('1');
    const second = await subscribe(monitor.url);
    expect(watchFactory).toHaveBeenCalledTimes(1);

    await writeFile(
      join(workspace, '.deckuse', 'operations.jsonl'),
      `${JSON.stringify({ revision: 'r1', slides: [2], operation: { type: 'setText' } })}\n`,
    );
    onChange?.();
    await eventually(() => expect(conversions).toHaveLength(1));
    await writeFile(
      join(workspace, '.deckuse', 'operations.jsonl'),
      `${JSON.stringify({ revision: 'r2', slides: [], operation: { type: 'remove' } })}\n`,
    );
    onChange?.();
    await new Promise((done) => setTimeout(done, 20));
    await conversions[0]!.finish();
    await eventually(() => expect(conversions).toHaveLength(2));
    expect(first.events.join('')).not.toContain('event: render');
    expect(conversions[1]?.page).toBe('2');
    await conversions[1]!.finish();
    await eventually(() => expect(first.events.join('')).toContain('event: render'));

    first.close();
    expect(watcher.close).not.toHaveBeenCalled();
    second.close();
    await eventually(() => expect(watcher.close).toHaveBeenCalledTimes(1));
    const calls = converter.mock.calls.length;
    onChange?.();
    await new Promise((done) => setTimeout(done, 20));
    expect(converter).toHaveBeenCalledTimes(calls);

    const third = await subscribe(monitor.url);
    await eventually(() => expect(watchFactory).toHaveBeenCalledTimes(2));
    await eventually(() => expect(converter.mock.calls.length).toBeGreaterThan(calls));
    third.close();
    await eventually(() => expect(watcher.close).toHaveBeenCalledTimes(2));
    await monitor.close();
  });

  it('keeps the previous preview when a conversion fails and blocks traversal', async () => {
    const workspace = await workspaceFixture();
    const converter = vi
      .fn()
      .mockImplementationOnce(async (_input: string, options: { output: string }) => {
        await writeFile(join(options.output, 'index.html'), 'preview');
        return {
          indexHtmlPath: join(options.output, 'index.html'),
          exitCode: 0,
          stdout: '',
          stderr: '',
        };
      })
      .mockResolvedValueOnce({ indexHtmlPath: '', exitCode: 1, stdout: '', stderr: 'broken' });
    let onChange: (() => void) | undefined;
    const monitor = await startMonitor(workspace, {
      port: 0,
      dependencies: {
        convert: converter,
        debounceMs: 1,
        watch: (_path: string, listener: () => void) => {
          onChange = listener;
          const watcher = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> };
          watcher.close = vi.fn();
          return watcher;
        },
      },
    });
    const client = await subscribe(monitor.url);
    await eventually(() => expect(client.events.join('')).toContain('event: render'));
    const render = client.events.join('').match(/"url":"([^"]+)"/)?.[1];
    expect(render).toBeDefined();
    expect((await fetch(new URL(render!, monitor.url))).status).toBe(200);
    expect((await fetch(`${monitor.url}render/%2e%2e/package.pptx`)).status).not.toBe(200);
    const versionUrl = new URL(render!, monitor.url);
    const versionName = versionUrl.pathname.split('/')[2]!;
    const linkPath = join(workspace, '.deckuse', 'monitor', versionName, 'escaped.pptx');
    try {
      await symlink(join(workspace, 'package.pptx'), linkPath);
      expect((await fetch(`${monitor.url}render/${versionName}/escaped.pptx`)).status).toBe(403);
    } catch (error) {
      if (process.platform !== 'win32') throw error;
    }

    await writeFile(
      join(workspace, '.deckuse', 'operations.jsonl'),
      `${JSON.stringify({ revision: 'failed', slides: [1], operation: { type: 'setText' } })}\n`,
    );
    onChange?.();
    await eventually(() => expect(client.events.join('')).toContain('broken'));
    expect((await fetch(new URL(render!, monitor.url))).status).toBe(200);
    client.close();
    await monitor.close();
  });

  it('rejects invalid workspaces before listening', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'deckuse-monitor-invalid-'));
    await expect(startMonitor(workspace, { port: 0 })).rejects.toThrow('Invalid deckuse workspace');
  });

  it('reports synchronous watcher startup failures without crashing the request', async () => {
    const workspace = await workspaceFixture();
    const monitor = await startMonitor(workspace, {
      port: 0,
      dependencies: {
        watch: () => {
          throw new Error('watch unavailable');
        },
      },
    });
    const client = await subscribe(monitor.url);
    await eventually(() => expect(client.events.join('')).toContain('watch unavailable'));
    client.close();
    await monitor.close();
  });

  it('reports watcher error events and closes the watcher', async () => {
    const workspace = await workspaceFixture();
    const watcher = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> };
    watcher.close = vi.fn();
    const monitor = await startMonitor(workspace, {
      port: 0,
      dependencies: { watch: () => watcher },
    });
    const client = await subscribe(monitor.url);
    watcher.emit('error', new Error('watch failed'));
    await eventually(() => expect(client.events.join('')).toContain('watch failed'));
    expect(watcher.close).toHaveBeenCalledTimes(1);
    client.close();
    await monitor.close();
  });
});
