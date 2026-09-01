import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import office2html from '@deckflow/office2html';
import {
  ensureGitignore,
  indexPath,
  monitorDir,
  operationsPath,
} from '@deckflow/deckuse-workspace';

const KEEPALIVE_MS = 15_000;
const DEBOUNCE_MS = 80;
const READ_RETRIES = 3;

interface OperationRecord {
  readonly revision?: string;
  readonly slides?: number[];
  readonly operation?: unknown;
}

interface MonitorState {
  readonly page: number;
  readonly signature: string;
}

export interface MonitorWatcher {
  close(): void;
  on(event: 'error', listener: (error: Error) => void): this;
}

export interface MonitorDependencies {
  readonly convert?: typeof office2html.convert;
  readonly watch?: (path: string, listener: () => void) => MonitorWatcher;
  readonly debounceMs?: number;
  readonly keepaliveMs?: number;
}

export interface MonitorOptions {
  readonly host?: string;
  readonly port?: number;
  readonly dependencies?: MonitorDependencies;
}

export interface MonitorHandle {
  readonly server: Server;
  readonly url: string;
  close(): Promise<void>;
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((done) => setTimeout(done, milliseconds));

const slideCount = async (workspace: string): Promise<number> => {
  const index = JSON.parse(await readFile(indexPath(workspace), 'utf8')) as {
    elements?: { kind?: string }[];
  };
  return Math.max(1, index.elements?.filter((element) => element.kind === 'slide').length ?? 0);
};

const readState = async (workspace: string): Promise<MonitorState> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < READ_RETRIES; attempt += 1) {
    try {
      const raw = await readFile(operationsPath(workspace), 'utf8').catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw error;
      });
      const lines = raw.split(/\r?\n/).filter(Boolean);
      const lastLine = lines.at(-1);
      const record = lastLine ? (JSON.parse(lastLine) as OperationRecord) : undefined;
      const page = record?.slides?.[0] ?? (record ? await slideCount(workspace) : 1);
      // The log is rewritten before and after its Git commit is known. Deliberately omit
      // gitCommit and operation payload so those two writes collapse into one state.
      return {
        page: Math.max(1, page),
        signature: JSON.stringify({
          revision: record?.revision ?? 'empty',
          slides: record?.slides ?? [],
          operation: record?.operation ?? null,
          length: lines.length,
        }),
      };
    } catch (error) {
      lastError = error;
      if (attempt + 1 < READ_RETRIES) await sleep(20 * (attempt + 1));
    }
  }
  throw lastError;
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const rootPage = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Deckuse monitor</title><style>
html,body,iframe{width:100%;height:100%;margin:0;border:0}body{background:#171717;color:#fff;font:14px system-ui}
#status{position:fixed;z-index:1;left:12px;bottom:12px;padding:7px 10px;border-radius:6px;background:#000b}
</style></head><body><iframe title="Presentation preview"></iframe><div id="status">Waiting for preview…</div>
<script>
const frame=document.querySelector('iframe'), status=document.querySelector('#status');
const events=new EventSource('/events');
events.addEventListener('render',event=>{frame.src=JSON.parse(event.data).url;status.hidden=true});
events.addEventListener('error-message',event=>{status.hidden=false;status.textContent=JSON.parse(event.data).message});
events.onerror=()=>{status.hidden=false;status.textContent='Preview connection lost; reconnecting…'};
</script></body></html>`;

const sendEvent = (response: ServerResponse, event: string, value: unknown): void => {
  response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
};

const validateWorkspace = async (workspace: string): Promise<void> => {
  const required = [
    { path: resolve(workspace, '.deckuse'), kind: 'directory' },
    { path: resolve(workspace, 'package.pptx'), kind: 'file' },
    { path: indexPath(workspace), kind: 'file' },
  ] as const;
  for (const item of required) {
    try {
      const info = await stat(item.path);
      if (item.kind === 'directory' ? !info.isDirectory() : !info.isFile())
        throw new Error(`Expected ${item.kind}: ${item.path}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Expected ')) throw error;
      throw new Error(`Invalid deckuse workspace; missing ${item.kind}: ${item.path}`, {
        cause: error,
      });
    }
  }
};

export const startMonitor = async (
  workspace: string,
  options: MonitorOptions = {},
): Promise<MonitorHandle> => {
  const absoluteWorkspace = resolve(workspace);
  await validateWorkspace(absoluteWorkspace);
  await ensureGitignore(absoluteWorkspace);
  const outputRoot = monitorDir(absoluteWorkspace);
  await mkdir(outputRoot, { recursive: true });
  const realOutputRoot = await realpath(outputRoot);
  const converter = options.dependencies?.convert ?? office2html.convert;
  const createWatcher = options.dependencies?.watch ?? watch;
  const debounceMs = options.dependencies?.debounceMs ?? DEBOUNCE_MS;
  const keepaliveMs = options.dependencies?.keepaliveMs ?? KEEPALIVE_MS;
  const clients = new Set<ServerResponse>();
  let watcher: MonitorWatcher | undefined;
  let debounce: NodeJS.Timeout | undefined;
  let keepalive: NodeJS.Timeout | undefined;
  let active = false;
  let converting = false;
  let queued: { state: MonitorState; generation: number } | undefined;
  let lastStateSignature: string | undefined;
  let latestRenderUrl: string | undefined;
  let version = 0;
  let generation = 0;

  const broadcast = (event: string, value: unknown): void => {
    for (const client of clients) sendEvent(client, event, value);
  };

  const takeQueued = (): { state: MonitorState; generation: number } | undefined => {
    const next = queued;
    queued = undefined;
    return next;
  };

  const runConversion = async (state: MonitorState, runGeneration: number): Promise<void> => {
    converting = true;
    const versionName = `${String(Date.now())}-${String(++version)}`;
    const output = resolve(outputRoot, versionName);
    try {
      await mkdir(output, { recursive: true });
      const result = await converter(resolve(absoluteWorkspace, 'package.pptx'), {
        output,
        pages: String(state.page),
      });
      if (result.exitCode !== 0) throw new Error(result.stderr || 'office2html conversion failed');
      const entry = resolve(result.indexHtmlPath);
      const entryRelative = relative(output, entry);
      if (
        entryRelative.startsWith(`..${sep}`) ||
        entryRelative === '..' ||
        resolve(output, entryRelative) !== entry
      )
        throw new Error('office2html returned an output outside its version directory');
      if (!queued && active && generation === runGeneration) {
        latestRenderUrl = `/render/${encodeURIComponent(versionName)}${entryRelative ? `/${entryRelative.split(sep).map(encodeURIComponent).join('/')}` : ''}`;
        broadcast('render', { url: latestRenderUrl, page: state.page });
      }
    } catch (error) {
      if (!queued && active && generation === runGeneration)
        broadcast('error-message', {
          message: error instanceof Error ? error.message : 'Preview conversion failed',
        });
    } finally {
      converting = false;
      const next = takeQueued();
      if (next && active && generation === next.generation)
        void runConversion(next.state, next.generation);
    }
  };

  const refresh = async (): Promise<void> => {
    if (!active) return;
    const refreshGeneration = generation;
    try {
      const state = await readState(absoluteWorkspace);
      if (generation !== refreshGeneration || state.signature === lastStateSignature) return;
      lastStateSignature = state.signature;
      if (converting) queued = { state, generation };
      else void runConversion(state, generation);
    } catch (error) {
      if (generation !== refreshGeneration) return;
      broadcast('error-message', {
        message: error instanceof Error ? error.message : 'Could not read workspace state',
      });
    }
  };

  const scheduleRefresh = (): void => {
    if (!active) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void refresh(), debounceMs);
  };

  const startWatching = (): void => {
    if (active) return;
    active = true;
    generation += 1;
    try {
      watcher = createWatcher(dirname(operationsPath(absoluteWorkspace)), scheduleRefresh);
      watcher.on('error', (error) => {
        if (!active) return;
        broadcast('error-message', { message: `Workspace watcher failed: ${error.message}` });
        stopWatching();
      });
    } catch (error) {
      broadcast('error-message', {
        message: `Could not watch workspace: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
      stopWatching();
      return;
    }
    keepalive = setInterval(() => {
      for (const client of clients) client.write(': keepalive\n\n');
    }, keepaliveMs);
    void refresh();
  };

  const stopWatching = (): void => {
    if (!active) return;
    active = false;
    generation += 1;
    watcher?.close();
    watcher = undefined;
    if (debounce) clearTimeout(debounce);
    debounce = undefined;
    if (keepalive) clearInterval(keepalive);
    keepalive = undefined;
    queued = undefined;
    lastStateSignature = undefined;
  };

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    if (requestUrl.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(rootPage);
      return;
    }
    if (requestUrl.pathname === '/events') {
      response.writeHead(200, {
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'content-type': 'text/event-stream',
      });
      response.write(': connected\n\n');
      clients.add(response);
      startWatching();
      if (latestRenderUrl) sendEvent(response, 'render', { url: latestRenderUrl });
      request.on('close', () => {
        clients.delete(response);
        if (clients.size === 0) stopWatching();
      });
      return;
    }
    if (requestUrl.pathname.startsWith('/render/')) {
      let segments: string[];
      try {
        segments = requestUrl.pathname.slice('/render/'.length).split('/').map(decodeURIComponent);
      } catch {
        response.writeHead(400).end();
        return;
      }
      if (
        segments.some(
          (segment) => !segment || segment === '.' || segment === '..' || segment.includes(sep),
        )
      ) {
        response.writeHead(403).end();
        return;
      }
      const file = resolve(outputRoot, ...segments);
      const relativeFile = relative(outputRoot, file);
      if (relativeFile.startsWith(`..${sep}`) || relativeFile === '..') {
        response.writeHead(403).end();
        return;
      }
      void Promise.all([stat(file), realpath(file)])
        .then(([info, realFile]) => {
          const realRelative = relative(realOutputRoot, realFile);
          if (
            !info.isFile() ||
            realRelative === '..' ||
            realRelative.startsWith(`..${sep}`) ||
            resolve(realOutputRoot, realRelative) !== realFile
          )
            throw Object.assign(new Error('Not a safe file'), { code: 'EACCES' });
          response.writeHead(200, {
            'content-type':
              CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
            'x-content-type-options': 'nosniff',
          });
          createReadStream(file)
            .on('error', () => response.destroy())
            .pipe(response);
        })
        .catch((error: unknown) => {
          const code = (error as NodeJS.ErrnoException).code;
          response.writeHead(code === 'ENOENT' ? 404 : code === 'EACCES' ? 403 : 500).end();
        });
      return;
    }
    response.writeHead(404).end();
  });

  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4173;
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      done();
    });
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    server,
    url: `http://${host}:${String(actualPort)}/`,
    close: async () => {
      for (const client of clients) client.end();
      clients.clear();
      stopWatching();
      await new Promise<void>((done, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else done();
        });
      });
    },
  };
};
