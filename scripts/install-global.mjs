#!/usr/bin/env node
/**
 * Build, deploy a self-contained @deckuse/cli tree, then globally link it.
 * Mimics `npm i -g @deckuse/cli` after publish, without needing registry versions.
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, '.tmp/global-install');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

rmSync(target, { recursive: true, force: true });
run('pnpm', ['build']);
run('pnpm', ['--filter', '@deckuse/cli', 'deploy', '--prod', '--legacy', target]);
// link (not install -g): keeps the deploy node_modules with workspace packages resolved,
// and --force overwrites an existing global `deckuse` bin if present.
run('npm', ['link', '--force'], { cwd: target });

const which = spawnSync('which', ['deckuse'], { encoding: 'utf8' });
const deckusePath = which.stdout?.trim();
if (deckusePath) {
  console.log(`\nGlobal deckuse ready: ${deckusePath}`);
  console.log('Try: deckuse init input.pptx ./workspace --json');
} else {
  console.log('\nLinked @deckuse/cli globally; ensure your npm global bin is on PATH.');
}
