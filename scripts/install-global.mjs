#!/usr/bin/env node
/**
 * Build, deploy a self-contained @deckflow/deckuse tree, then globally link it.
 * Mimics `npm i -g @deckflow/deckuse` after publish, without needing registry versions.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, '.tmp/global-install');

/** Strip pnpm-injected npm_config_* so nested `npm` won't warn on unknown keys. */
function cleanNpmEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^npm_config_/i.test(key)) delete env[key];
  }
  return env;
}

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
run('pnpm', ['--filter', './packages/deckuse', 'deploy', '--prod', target]);
// tsc emits 644; npm link creates a direct symlink to the bin, so it must be executable.
chmodSync(join(target, 'dist/bin.js'), 0o755);
// link (not install -g): keeps the deploy node_modules with workspace packages resolved,
// and --force overwrites an existing global `deckuse` bin if present.
run('npm', ['link', '--force'], { cwd: target, env: cleanNpmEnv() });

const which = spawnSync('which', ['deckuse'], { encoding: 'utf8' });
const deckusePath = which.stdout?.trim();
if (deckusePath) {
  console.log(`\nGlobal deckuse ready: ${deckusePath}`);
  console.log('Try: deckuse init input.pptx ./workspace --json');
} else {
  console.log('\nLinked @deckflow/deckuse globally; ensure your npm global bin is on PATH.');
}
