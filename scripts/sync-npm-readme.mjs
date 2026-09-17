#!/usr/bin/env node
/**
 * Copy the repo-root README.md and LICENSE into packages/deckuse for npm publish,
 * rewriting relative repo links to absolute GitHub URLs.
 */
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const githubBlobBase = 'https://github.com/deckflow/deckuse/blob/main';
const packageDir = resolve(root, 'packages/deckuse');

function isExternalOrAnchor(href) {
  return (
    href.startsWith('#') ||
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('mailto:')
  );
}

function toGithubBlobUrl(href) {
  const normalized = href.replace(/^\.\//, '');
  return `${githubBlobBase}/${normalized}`;
}

function rewriteMarkdownLinks(markdown) {
  return markdown.replace(/\]\(([^)]+)\)/g, (match, href) => {
    const trimmed = href.trim();
    if (isExternalOrAnchor(trimmed)) {
      return match;
    }
    return `](${toGithubBlobUrl(trimmed)})`;
  });
}

function rewriteSchemaPathMention(markdown) {
  const schemaPath = 'packages/core/schema/command.schema.json';
  const linked = `[\`${schemaPath}\`](${toGithubBlobUrl(schemaPath)})`;
  return markdown.replaceAll(`\`${schemaPath}\``, linked);
}

const readmeSource = resolve(root, 'README.md');
const licenseSource = resolve(root, 'LICENSE');
const readmeTarget = resolve(packageDir, 'README.md');
const licenseTarget = resolve(packageDir, 'LICENSE');

const rawReadme = await readFile(readmeSource, 'utf8');
const npmReadme = rewriteSchemaPathMention(rewriteMarkdownLinks(rawReadme));

await writeFile(readmeTarget, npmReadme);
await copyFile(licenseSource, licenseTarget);

console.log(`Synced npm README and LICENSE into ${packageDir}`);
