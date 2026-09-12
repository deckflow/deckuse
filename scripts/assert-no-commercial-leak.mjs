#!/usr/bin/env node
/**
 * Fail community publish/CI if proprietary commercial packages appear in the
 * dependency tree or in package source paths. Public repo must never ship class-B code.
 */
import { pathToFileURL } from 'node:url';
import { readdirSync, readFileSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();

/** Package names that must never appear as dependencies of the community tree. */
const FORBIDDEN_PACKAGE_NAMES = [
  '@deckflow/deckuse-office2html-plus',
  '@deckflow/office2html-plus',
  '@deckflow/deckuse-commercial-smartart',
];

/** Path substrings that must never exist under this repo. */
const FORBIDDEN_PATH_MARKERS = ['office2html-plus', 'deckuse-commercial/packages'];

const errors = [];

const walk = (dir, out = []) => {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // broken symlink etc.
    }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

for (const marker of FORBIDDEN_PATH_MARKERS) {
  const hit = walk(root).find((p) => relative(root, p).includes(marker));
  if (hit) errors.push(`Forbidden path marker "${marker}" found at ${relative(root, hit)}`);
}

const pkgPaths = walk(join(root, 'packages')).filter((p) => p.endsWith('package.json'));

for (const pkgPath of pkgPaths) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies,
  };
  for (const name of FORBIDDEN_PACKAGE_NAMES) {
    if (deps[name]) {
      errors.push(`${relative(root, pkgPath)} depends on forbidden package ${name}`);
    }
  }
}

const editionSrc = join(root, 'packages/edition-config/src/index.ts');
if (!existsSync(editionSrc)) {
  errors.push('packages/edition-config/src/index.ts missing');
} else {
  const src = readFileSync(editionSrc, 'utf8');
  if (!src.includes("export const EDITION: Edition = 'community'")) {
    errors.push('edition-config source must set EDITION to community');
  }
  if (!src.includes("export const DISTRIBUTION_CHANNEL = 'oss'")) {
    errors.push('edition-config source must set DISTRIBUTION_CHANNEL to oss');
  }
  if (!src.includes('mastersEdit: false')) {
    errors.push('community edition-config must set mastersEdit: false');
  }
}

const linked = join(root, 'packages/pptx/node_modules/@deckflow/deckuse-edition-config');
if (!existsSync(linked)) {
  errors.push('pptx cannot resolve workspace @deckflow/deckuse-edition-config (run pnpm install)');
} else {
  try {
    const real = realpathSync(linked);
    if (!real.includes(`${join('packages', 'edition-config')}`)) {
      errors.push(
        `@deckflow/deckuse-edition-config linked outside packages/edition-config: ${real}`,
      );
    }
  } catch (err) {
    errors.push(
      `Failed to realpath edition-config link: ${err instanceof Error ? err.message : err}`,
    );
  }
}

const distJs = join(root, 'packages/edition-config/dist/index.js');
if (existsSync(distJs)) {
  try {
    const cfg = await import(pathToFileURL(distJs).href);
    if (cfg.EDITION !== 'community' || cfg.DISTRIBUTION_CHANNEL !== 'oss') {
      errors.push(
        `edition-config must be community/oss in this repo (got edition=${cfg.EDITION}, channel=${cfg.DISTRIBUTION_CHANNEL})`,
      );
    }
    if (cfg.editionCapabilities?.mastersEdit === true) {
      errors.push('community edition-config must not enable mastersEdit');
    }
  } catch (err) {
    errors.push(
      `Failed to import edition-config dist: ${err instanceof Error ? err.message : err}`,
    );
  }
}

if (errors.length) {
  console.error('check:no-commercial-leak failed:\n' + errors.map((e) => ` - ${e}`).join('\n'));
  process.exit(1);
}

console.log('check:no-commercial-leak: ok');
