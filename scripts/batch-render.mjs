#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/deckuse', import.meta.url));
const builtCli = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
let command = cli;
let commandPrefix = [];
const defaultConcurrency = Math.max(1, cpus().length - 2);
const usage = `Usage: node scripts/batch-render.mjs [options] <file|workspace|directory> ...

Render PPTX/DOCX files or Deckuse workspaces to PNG using this project's bin/deckuse.
Directories without a workspace manifest are scanned for immediate PPTX/DOCX files.

  -j, --concurrency <n>  Concurrent inputs (default: CPU cores - 2, minimum 1)
  --output-dir <dir>    Output root (default: ./batch-render-output)
  --scale <n>          Positive screenshot scale passed to deckuse render
  -h, --help           Show help

Each input gets its own numbered output directory; all pages are rendered.
Failed inputs do not stop other inputs. Exit status is 1 if any input fails.
`;

function run(args) {
  return new Promise((done, reject) => {
    const child = spawn(command, [...commandPrefix, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) done();
      else reject(new Error(`deckuse ${args[0]} failed (${signal ?? code}):\n${output.trim()}`));
    });
  });
}

async function isWorkspace(path) {
  try {
    await access(join(path, '.deckuse', 'manifest.json'));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    return;
  }
  let concurrency = defaultConcurrency;
  let outputRoot = resolve('batch-render-output');
  let scale;
  const inputs = [];
  while (args.length) {
    const arg = args.shift();
    if (arg === '--') {
      inputs.push(...args);
      break;
    }
    if (['-j', '--concurrency', '--output-dir', '--scale'].includes(arg)) {
      const value = args.shift();
      if (!value) throw new Error(`Missing value for ${arg}`);
      if (arg === '--output-dir') outputRoot = resolve(value);
      else if (arg === '--scale') {
        scale = Number(value);
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('--scale must be positive');
      } else {
        concurrency = Number(value);
        if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
          throw new Error('--concurrency must be a positive integer');
        }
      }
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else inputs.push(arg);
  }
  if (!inputs.length) throw new Error(usage);
  const jobs = new Map();
  async function collect(input) {
    const path = resolve(input);
    const info = await stat(path);
    if (info.isDirectory()) {
      if (await isWorkspace(path)) jobs.set(path, { path, workspace: true });
      else {
        for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
          a.name.localeCompare(b.name),
        )) {
          if (
            entry.isFile() &&
            !entry.name.startsWith('~$') &&
            /\.(pptx|docx)$/i.test(entry.name)
          ) {
            await collect(join(path, entry.name));
          }
        }
      }
    } else if (info.isFile() && /\.(pptx|docx)$/i.test(path))
      jobs.set(path, { path, workspace: false });
    else throw new Error(`Unsupported input: ${path}`);
  }
  for (const input of inputs) await collect(input);
  if (!jobs.size) throw new Error('No PPTX/DOCX files or workspaces found');
  try {
    await access(cli);
  } catch {
    try {
      await access(builtCli);
    } catch {
      throw new Error('Project CLI is unavailable. Run pnpm build to generate dist/bin.js.');
    }
    command = process.execPath;
    commandPrefix = [builtCli];
    console.log('bin/deckuse is unavailable; using project build dist/bin.js');
  }
  await mkdir(outputRoot, { recursive: true });
  const queue = [...jobs.values()];
  let next = 0;
  let failures = 0;
  console.log(`Rendering ${queue.length} input(s), concurrency ${concurrency}`);
  async function worker() {
    while (next < queue.length) {
      const index = next++;
      const job = queue[index];
      const name = job.workspace ? basename(job.path) : basename(job.path, extname(job.path));
      const output = join(outputRoot, `${String(index + 1).padStart(4, '0')}-${name}`);
      let temporary;
      try {
        let workspace = job.path;
        if (!job.workspace) {
          temporary = await mkdtemp(join(tmpdir(), 'deckuse-batch-render-'));
          workspace = join(temporary, 'workspace');
          await run(['init', job.path, workspace, '--json']);
        }
        await run([
          'render',
          '--workspace',
          workspace,
          '--all',
          '--output-dir',
          output,
          ...(scale === undefined ? [] : ['--scale', String(scale)]),
          '--json',
        ]);
        console.log(`[${index + 1}/${queue.length}] OK ${job.path} -> ${output}`);
      } catch (error) {
        failures++;
        console.error(`[${index + 1}/${queue.length}] FAIL ${job.path}: ${error.message}`);
      } finally {
        if (temporary)
          await rm(temporary, { recursive: true, force: true }).catch((error) => {
            console.error(`Could not clean temporary workspace ${temporary}: ${error.message}`);
          });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  console.log(
    `Finished: ${queue.length - failures} succeeded, ${failures} failed. Output: ${outputRoot}`,
  );
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
