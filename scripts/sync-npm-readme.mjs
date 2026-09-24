#!/usr/bin/env node
/**
 * Rewrite root README.md relative links to absolute GitHub URLs for npm publish.
 * Use --restore to check out README.md from git after pack/publish.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const githubBlobBase = 'https://github.com/deckflow/deckuse/blob/main';
const restore = process.argv.includes('--restore');

if (restore) {
  const result = spawnSync('git', ['checkout', '--', 'README.md'], {
    cwd: root,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

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
  const schemaPath = 'schema/command.schema.json';
  const linked = `[\`${schemaPath}\`](${toGithubBlobUrl(schemaPath)})`;
  return markdown.replaceAll(`\`${schemaPath}\``, linked);
}

const readmePath = resolve(root, 'README.md');
const rawReadme = await readFile(readmePath, 'utf8');
const npmReadme = rewriteSchemaPathMention(rewriteMarkdownLinks(rawReadme));
await writeFile(readmePath, npmReadme);

console.log(`Rewrote npm README links in ${readmePath}`);
