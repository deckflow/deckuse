#!/usr/bin/env node
/**
 * Optional openability probe for exported Office packages.
 *
 * Tries, in order:
 *   1. LibreOffice / soffice headless convert-to pdf (CI-friendly when installed)
 *   2. macOS `osascript` open+close via PowerPoint/Word when
 *      DECKUSE_OPENABILITY=osascript (or --osascript) — opt-in; may show GUI
 *
 * Usage:
 *   node scripts/check-openability.mjs <file.pptx|file.docx|dir>
 *   pnpm test:openability -- <path>
 *   DECKUSE_OPENABILITY=osascript pnpm test:openability -- <path>
 *
 * Exit 0 = all probed files converted/opened without tool error.
 * Exit 2 = no probe backend available (skipped, not a product failure).
 * Exit 1 = a probe failed.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

const PACKAGE_EXTS = new Set(['.pptx', '.docx']);

const takeFlag = (list, name) => {
  const i = list.indexOf(name);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
};

const run = (cmd, args, opts = {}) =>
  new Promise((done) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += String(c);
    });
    child.stderr.on('data', (c) => {
      stderr += String(c);
    });
    child.on('error', (error) => done({ code: 127, stdout, stderr, error }));
    child.on('close', (code) => done({ code: code ?? 1, stdout, stderr }));
  });

const which = async (names) => {
  for (const name of names) {
    const result = await run('which', [name]);
    if (result.code === 0) {
      const path = result.stdout.trim().split('\n')[0];
      if (path) return path;
    }
  }
  return undefined;
};

/** Resolve a working LibreOffice binary (ignore broken Homebrew stubs). */
const resolveSoffice = async () => {
  const candidate = await which(['soffice', 'libreoffice']);
  if (!candidate) return undefined;
  const probe = await run(candidate, ['--version']);
  if (probe.code !== 0) return undefined;
  return candidate;
};

const collectPackages = async (input) => {
  const st = await stat(input);
  if (st.isFile()) {
    if (!PACKAGE_EXTS.has(extname(input).toLowerCase())) {
      throw new Error(`Not a .pptx/.docx: ${input}`);
    }
    return [input];
  }
  if (!st.isDirectory()) throw new Error(`Not a file or directory: ${input}`);
  const found = [];
  for (const name of await readdir(input)) {
    // `~$…` is an Office lock file, not a package.
    if (name.startsWith('~$') || name.startsWith('.')) continue;
    if (PACKAGE_EXTS.has(extname(name).toLowerCase())) {
      found.push(join(input, name));
    }
  }
  return found.sort();
};

const probeLibreOffice = async (soffice, file, outDir) => {
  const result = await run(soffice, [
    '--headless',
    '--nologo',
    '--nolockcheck',
    '--convert-to',
    'pdf',
    '--outdir',
    outDir,
    file,
  ]);
  if (result.code !== 0) {
    return {
      ok: false,
      backend: 'libreoffice',
      error: result.stderr.trim() || result.stdout.trim() || `exit ${String(result.code)}`,
    };
  }
  return { ok: true, backend: 'libreoffice' };
};

const probeMacOpen = async (file) => {
  const ext = extname(file).toLowerCase();
  const app = ext === '.docx' ? 'Microsoft Word' : 'Microsoft PowerPoint';
  // Open then immediately close without saving. Does not assert absence of repair UI.
  const script = `
set theFile to POSIX file ${JSON.stringify(file)}
tell application ${JSON.stringify(app)}
  activate
  open theFile
  delay 2
  close every window saving no
end tell
`;
  const result = await run('osascript', ['-e', script]);
  if (result.code !== 0) {
    return {
      ok: false,
      backend: 'osascript',
      error: result.stderr.trim() || result.stdout.trim() || `exit ${String(result.code)}`,
    };
  }
  return { ok: true, backend: 'osascript' };
};

const main = async () => {
  const rawArgs = process.argv.slice(2).filter((arg) => arg !== '--');
  const wantOsascript =
    takeFlag(rawArgs, '--osascript') || process.env.DECKUSE_OPENABILITY === 'osascript';
  const input = rawArgs[0];
  if (!input || input === '--help' || input === '-h') {
    process.stdout.write(
      'usage: node scripts/check-openability.mjs <file.pptx|file.docx|dir> [--osascript]\n',
    );
    process.exitCode = input ? 0 : 2;
    return;
  }

  const files = await collectPackages(resolve(input));
  if (files.length === 0) {
    process.stderr.write(`No .pptx/.docx under ${input}\n`);
    process.exitCode = 1;
    return;
  }

  const soffice = await resolveSoffice();
  const canOsascript =
    wantOsascript &&
    process.platform === 'darwin' &&
    (await which(['osascript'])) !== undefined;

  if (!soffice && !canOsascript) {
    process.stdout.write(
      'SKIP: no working LibreOffice (soffice). For macOS GUI probe, pass --osascript or DECKUSE_OPENABILITY=osascript\n',
    );
    process.exitCode = 2;
    return;
  }

  const outDir = soffice ? await mkdtemp(join(tmpdir(), 'deckuse-openability-')) : undefined;
  let failed = 0;

  for (const file of files) {
    process.stdout.write(`→ ${basename(file)} … `);
    let result;
    if (soffice && outDir) {
      result = await probeLibreOffice(soffice, file, outDir);
    } else {
      result = await probeMacOpen(file);
    }
    if (result.ok) {
      process.stdout.write(`ok (${result.backend})\n`);
    } else {
      failed += 1;
      process.stdout.write(`FAIL (${result.backend}): ${result.error}\n`);
    }
  }

  if (failed > 0) process.exitCode = 1;
  else process.stdout.write(`openability: ${String(files.length)} file(s) ok\n`);
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
