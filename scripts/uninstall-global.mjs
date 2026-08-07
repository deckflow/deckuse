#!/usr/bin/env node
/**
 * Remove the globally linked @deckflow/deckuse (from install:global).
 */
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^npm_config_/i.test(key)) delete env[key];
}

// cwd outside the repo so npm does not load pnpm-only keys from ./.npmrc
const result = spawnSync('npm', ['unlink', '-g', '@deckflow/deckuse'], {
  cwd: homedir(),
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});
process.exit(result.status ?? 1);
