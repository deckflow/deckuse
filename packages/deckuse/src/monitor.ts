import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import office2html from '@deckflow/office2html';
import {
  ensureGitignore,
  indexPath,
  lockPath,
  monitorDir,
  operationsPath,
} from '@deckflow/deckuse-workspace';

const KEEPALIVE_MS = 15_000;
const DEBOUNCE_MS = 80;
const READ_RETRIES = 3;

interface OperationRecord {
  readonly at?: string;
  readonly revision?: string;
  readonly slides?: number[];
  readonly operation?: unknown;
  readonly gitCommit?: string;
}

interface MonitorMeta {
  readonly page: number;
  readonly slideCount: number;
  readonly summary: string;
  readonly record: OperationRecord | null;
}

interface MonitorState extends MonitorMeta {
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

const summarizeRecord = (record: OperationRecord | undefined, page: number): string => {
  if (!record) return 'No changes yet — showing initial preview';
  const operation =
    record.operation && typeof record.operation === 'object'
      ? (record.operation as Record<string, unknown>)
      : undefined;
  if (typeof operation?.['reason'] === 'string' && operation['reason'].trim())
    return operation['reason'].trim();
  const type = typeof operation?.['type'] === 'string' ? operation['type'] : 'write';
  const slides = record.slides?.length
    ? ` on slide${record.slides.length === 1 ? '' : 's'} ${record.slides.join(', ')}`
    : ` (previewing slide ${String(page)})`;
  if (type === 'replaceText' && typeof operation?.['find'] === 'string') {
    return `Replaced “${operation['find']}” with “${String(operation['replace'] ?? '')}”${slides}`;
  }
  if (type === 'setText') return `Updated text${slides}`;
  if (record.revision) return `${type} · revision ${record.revision}${slides}`;
  return `${type}${slides}`;
};

const readLatestRecord = async (workspace: string): Promise<OperationRecord | undefined> => {
  const raw = await readFile(operationsPath(workspace), 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  });
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const lastLine = lines.at(-1);
  return lastLine ? (JSON.parse(lastLine) as OperationRecord) : undefined;
};

const isWriteLocked = async (workspace: string): Promise<boolean> => {
  try {
    await stat(lockPath(workspace));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};

/** mtime+size of package.pptx so undo/repack with the same ops still re-converts. */
const packageFingerprint = async (workspace: string): Promise<string> => {
  try {
    const info = await stat(resolve(workspace, 'package.pptx'));
    return `${String(info.mtimeMs)}:${String(info.size)}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
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
      const totalSlides = await slideCount(workspace);
      const page = Math.min(
        totalSlides,
        Math.max(1, record?.slides?.[0] ?? (record ? totalSlides : 1)),
      );
      const packageId = await packageFingerprint(workspace);
      // The log is rewritten before and after its Git commit is known. Deliberately omit
      // gitCommit so those two writes collapse into one state. Include package.pptx
      // fingerprint so undo (ops roll back before pack finishes) still re-converts.
      return {
        page,
        slideCount: totalSlides,
        summary: summarizeRecord(record, page),
        record: record ?? null,
        signature: JSON.stringify({
          revision: record?.revision ?? 'empty',
          slides: record?.slides ?? [],
          operation: record?.operation ?? null,
          length: lines.length,
          package: packageId,
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
*{box-sizing:border-box}
html,body{height:100%;margin:0;background:#171717;color:#e8e8e8;font:14px system-ui,sans-serif}
#app{display:flex;flex-direction:column;height:100%}
#preview{flex:1;min-height:0;position:relative;background:#0d0d0d}
#preview iframe{width:100%;height:100%;border:0;background:#0d0d0d}
#status{position:absolute;z-index:1;left:12px;bottom:12px;padding:7px 10px;border-radius:6px;background:#000b}
#dock{flex:0 0 auto;border-top:1px solid #2a2a2a;background:#1c1c1c}
#change{display:flex;align-items:flex-start;gap:8px;padding:10px 14px;cursor:pointer;border-bottom:1px solid #2a2a2a;user-select:none}
#change:hover{background:#222}
#change .chevron{flex:0 0 auto;color:#888;transition:transform .15s ease;line-height:1.4}
#change.open .chevron{transform:rotate(90deg)}
#summary{flex:1;line-height:1.4;color:#ddd}
#summary .muted{color:#888}
#details{display:none;padding:0 14px 12px}
#details.open{display:block}
#details pre{margin:0;padding:10px;max-height:36vh;overflow:auto;border-radius:6px;background:#111;color:#c8c8c8;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
#slides{display:flex;gap:10px;padding:12px 14px;overflow-x:auto}
.slide{flex:0 0 auto;width:96px}
.slide .thumb{position:relative;aspect-ratio:16/9;border-radius:5px;border:2px solid #333;background:linear-gradient(160deg,#2c2c2c,#1a1a1a);overflow:hidden}
.slide .thumb .bars{position:absolute;inset:16% 12% auto;display:flex;flex-direction:column;gap:5px}
.slide .thumb .bars span{display:block;height:5px;border-radius:1px;background:#3a3a3a}
.slide .thumb .bars span:nth-child(1){width:78%}
.slide .thumb .bars span:nth-child(2){width:92%}
.slide .thumb .bars span:nth-child(3){width:54%}
.slide .label{margin-top:5px;text-align:center;font-size:11px;color:#888}
.slide.active .thumb{border-color:#5b9fff;box-shadow:0 0 0 1px #5b9fff55}
.slide.active .label{color:#5b9fff;font-weight:600}
.slide.affected:not(.active) .thumb{border-color:#5a6a3a}
</style></head><body>
<div id="app">
  <div id="preview"><iframe title="Presentation preview"></iframe><div id="status">Waiting for preview…</div></div>
  <div id="dock">
    <div id="change"><span class="chevron">▸</span><div id="summary"><span class="muted">Waiting for workspace…</span></div></div>
    <div id="details"><pre></pre></div>
    <div id="slides"></div>
  </div>
</div>
<script>
const frame=document.querySelector('iframe');
const status=document.querySelector('#status');
const change=document.querySelector('#change');
const summary=document.querySelector('#summary');
const details=document.querySelector('#details');
const detailsPre=document.querySelector('#details pre');
const slides=document.querySelector('#slides');
let open=false;
const applyMeta=(data)=>{
  const page=Math.max(1,Number(data.page)||1);
  const count=Math.max(page,Number(data.slideCount)||1);
  const affected=new Set(Array.isArray(data.record?.slides)?data.record.slides:[]);
  summary.textContent=data.summary||'No changes yet — showing initial preview';
  detailsPre.textContent=data.record?JSON.stringify(data.record,null,2):'No operation record yet.';
  slides.replaceChildren();
  for(let i=1;i<=count;i++){
    const item=document.createElement('div');
    item.className='slide'+(i===page?' active':'')+(affected.has(i)?' affected':'');
    item.innerHTML='<div class="thumb"><div class="bars"><span></span><span></span><span></span></div></div><div class="label">Slide '+i+'</div>';
    slides.appendChild(item);
  }
};
change.addEventListener('click',()=>{
  open=!open;
  change.classList.toggle('open',open);
  details.classList.toggle('open',open);
});
const events=new EventSource('/events');
events.addEventListener('state',event=>applyMeta(JSON.parse(event.data)));
events.addEventListener('render',event=>{
  const data=JSON.parse(event.data);
  frame.src=data.url;
  applyMeta(data);
  status.hidden=true;
});
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
  let latestMeta: MonitorMeta | undefined;
  let latestRenderUrl: string | undefined;
  let version = 0;
  let generation = 0;

  const broadcast = (event: string, value: unknown): void => {
    for (const client of clients) sendEvent(client, event, value);
  };

  const publishMeta = async (state: MonitorState): Promise<MonitorMeta> => {
    // Re-read so the UI can show gitCommit after the second operations write.
    const fresh = await readLatestRecord(absoluteWorkspace).catch(() => state.record ?? undefined);
    const record = fresh ?? state.record;
    const meta: MonitorMeta = {
      page: state.page,
      slideCount: state.slideCount,
      summary: summarizeRecord(record ?? undefined, state.page),
      record: record ?? null,
    };
    latestMeta = meta;
    broadcast('state', meta);
    return meta;
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
      // Writers hold write.lock across source/ops/pack. Never convert mid-mutation.
      if (await isWriteLocked(absoluteWorkspace)) {
        if (lastStateSignature === state.signature) lastStateSignature = undefined;
        scheduleRefresh();
        return;
      }
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
        const meta = await publishMeta(state);
        latestRenderUrl = `/render/${encodeURIComponent(versionName)}${entryRelative ? `/${entryRelative.split(sep).map(encodeURIComponent).join('/')}` : ''}`;
        broadcast('render', { url: latestRenderUrl, ...meta });
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
      // Skip while a write/undo holds the lock. Do not update lastStateSignature —
      // otherwise the post-unlock consistent state can be treated as a no-op.
      if (await isWriteLocked(absoluteWorkspace)) return;
      const state = await readState(absoluteWorkspace);
      if (generation !== refreshGeneration) return;
      if (await isWriteLocked(absoluteWorkspace)) return;
      if (state.signature === lastStateSignature) return;
      lastStateSignature = state.signature;
      await publishMeta(state);
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
      if (latestMeta) sendEvent(response, 'state', latestMeta);
      if (latestRenderUrl && latestMeta)
        sendEvent(response, 'render', { url: latestRenderUrl, ...latestMeta });
      else if (latestRenderUrl) sendEvent(response, 'render', { url: latestRenderUrl });
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

  const host = options.host ?? '0.0.0.0';
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
  const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  return {
    server,
    url: `http://${displayHost}:${String(actualPort)}/`,
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
