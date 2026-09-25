#!/usr/bin/env node
/**
 * Fast curated integration smoke: blank PPTX + DOCX fixtures with default batching.
 *
 * Usage:
 *   node scripts/integration-writes-smoke.mjs
 *   pnpm test:integration-writes:smoke
 *
 * For large corpus scans use:
 *   pnpm test:integration-writes:corpus -- <dir>
 */
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HARNESS = join(ROOT, 'scripts/integration-writes.mjs');
const FIXTURES = join(ROOT, 'test/fixtures/integration');
const BIN = join(ROOT, 'dist/bin.js');

const main = async () => {
  try {
    await access(BIN);
  } catch {
    process.stderr.write('dist/bin.js missing — run pnpm build first\n');
    process.exitCode = 1;
    return;
  }

  const extra = process.argv.slice(2);
  const args = [
    HARNESS,
    FIXTURES,
    '--bin',
    BIN,
    '--force',
    '--skip-new',
    // batch is default; pass through extra flags (e.g. --no-batch, --continue-on-error)
    ...extra,
  ];

  process.stdout.write(
    `integration-writes smoke: ${FIXTURES} (batch default, --force --skip-new)\n`,
  );

  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  child.on('close', (code) => {
    process.exitCode = code === null ? 1 : code;
  });
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
