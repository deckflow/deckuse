#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpcArchive } from '../dist/opc/index.js';

const bin = resolve(process.argv[2] ?? 'dist/bin.js');
const root = await mkdtemp(join(tmpdir(), 'deckuse-retention-'));
const source = join(root, 'media-heavy.pptx');
const workspace = join(root, 'workspace');
const media = 'ppt/media/benchmark.bin';
const archive = await OpcArchive.openFile(
  fileURLToPath(new URL('../assets/blank.pptx', import.meta.url)),
);
archive.setPart('/' + media, randomBytes(16 * 1024 * 1024));
await archive.writeFile(source);

function cli(...args) {
  const result = JSON.parse(
    execFileSync(process.execPath, [bin, ...args, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, DECKUSE_CLEANUP_MODE: 'retire' },
    }),
  );
  if (!result.ok) throw Error(JSON.stringify(result));
  return result;
}

async function bytes(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return info.size;
  const sizes = await Promise.all((await readdir(path)).map((name) => bytes(join(path, name))));
  return sizes.reduce((total, size) => total + size, 0);
}

cli('init', source, workspace);
const trash = join(workspace, '.deckuse-trash');
const rows = [];
for (let write = 1; write <= 3; write++) {
  const start = performance.now();
  const envelope = cli('add', 'slide', '--name', 'Slide ' + write, '--workspace', workspace);
  const journal = envelope.data.cleanupRetirements?.find(
    ({ category }) => category === 'transaction',
  );
  if (!journal) throw Error('Expected a retired transaction');
  const backup = join(journal.retiredPath, 'backup');
  rows.push({
    write,
    elapsedMs: Math.round(performance.now() - start),
    backupBytes: await bytes(backup),
    retiredBytes: await bytes(trash),
  });
}
console.log(
  JSON.stringify(
    { workspace, mediaBytes: await bytes(join(workspace, 'source', media)), rows },
    null,
    2,
  ),
);
