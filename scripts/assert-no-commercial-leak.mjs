#!/usr/bin/env node
/**
 * Fail community publish/CI if proprietary commercial packages appear in the
 * dependency tree or in package source paths. Public repo must never ship class-B code.
 * Runtime license / certificate verification must live only in deckuse-commercial.
 */
import { pathToFileURL } from 'node:url';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();

/** Package names that must never appear as dependencies of the community tree. */
const FORBIDDEN_PACKAGE_NAMES = [
  '@deckflow/deckuse-office2html-plus',
  '@deckflow/office2html-plus',
  '@deckflow/deckuse-commercial-smartart',
  '@deckflow/deckuse-commercial-pptx',
  '@deckflow/deckuse-commercial',
];

/** Path substrings that must never exist under this repo. */
const FORBIDDEN_PATH_MARKERS = [
  'office2html-plus',
  'deckuse-commercial/packages',
  `${sep}licensing${sep}`,
  `${sep}licensing`,
];

/**
 * Source markers for commercial runtime license / certificate verification.
 * package.json "license" SPDX fields are not scanned (only .ts/.js/.mjs).
 */
const FORBIDDEN_LICENSE_MARKERS = [
  'ensureActivated',
  'LicenseException',
  'DECKUSE_LICENSE',
  'OFFICE2HTML_LICENSE',
  'verifyLicense',
  'issueLicense',
  'takeLicenseOption',
  'peekLicenseOption',
  '--license',
  'deckuse.lic',
];

/** License APIs that must never be exported from community edition-config dist. */
const FORBIDDEN_LICENSE_EXPORTS = [
  'ensureActivated',
  'ensureActivatedFromArgv',
  'LicenseException',
  'takeLicenseOption',
  'peekLicenseOption',
  'verifyLicenseText',
  'issueLicense',
  'isLicenseActivated',
  'getLicensePayload',
  'getLicenseCustomerName',
  'LICENSE_ENV_VAR',
];

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
    if (st.isDirectory()) {
      // Catch a dedicated licensing/ tree even if it only contains ignored dirs later.
      if (name === 'licensing') {
        out.push(full);
      }
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
};

const allFiles = walk(root);

for (const marker of FORBIDDEN_PATH_MARKERS) {
  const hit = allFiles.find((p) => {
    const rel = relative(root, p);
    if (marker === `${sep}licensing` || marker === `${sep}licensing${sep}`) {
      return (
        rel === 'licensing' ||
        rel.startsWith(`licensing${sep}`) ||
        rel.includes(`${sep}licensing${sep}`) ||
        rel.endsWith(`${sep}licensing`)
      );
    }
    return rel.includes(marker);
  });
  if (hit) errors.push(`Forbidden path marker "${marker}" found at ${relative(root, hit)}`);
}

const pkgPath = join(root, 'package.json');
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies,
  };
  for (const name of FORBIDDEN_PACKAGE_NAMES) {
    if (deps[name]) {
      errors.push(`package.json depends on forbidden package ${name}`);
    }
  }
}

const sourceExt = /\.(ts|js|mjs)$/;
const sourceRoot = join(root, 'src');
const underSource = (p) => p === sourceRoot || p.startsWith(`${sourceRoot}${sep}`);
const sourceFiles = allFiles.filter((p) => sourceExt.test(p) && underSource(p));

for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  for (const marker of FORBIDDEN_LICENSE_MARKERS) {
    if (text.includes(marker)) {
      errors.push(`Forbidden license/certificate marker "${marker}" in ${relative(root, file)}`);
    }
  }
}

const editionSrc = join(root, 'src/edition-config/index.ts');
if (!existsSync(editionSrc)) {
  errors.push('src/edition-config/index.ts missing');
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

const distJs = join(root, 'dist/edition-config/index.js');
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
    if (cfg.editionCapabilities?.layoutsEdit === true) {
      errors.push('community edition-config must not enable layoutsEdit');
    }
    if (cfg.editionCapabilities?.chartBasicOnly === false) {
      errors.push('community edition-config must keep chartBasicOnly true');
    }
    for (const name of FORBIDDEN_LICENSE_EXPORTS) {
      if (name in cfg && cfg[name] !== undefined) {
        errors.push(`community edition-config must not export license API "${name}"`);
      }
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
