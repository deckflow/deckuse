#!/usr/bin/env node
/**
 * Integration harness: run every Deckuse write path against .pptx file(s).
 *
 * Usage:
 *   node scripts/integration-writes.mjs <dir>          # every .pptx under dir
 *   node scripts/integration-writes.mjs <file.pptx>    # single file (debug loop)
 *   pnpm test:integration-writes -- <dir|file.pptx>
 *
 * For each `foo.pptx`, workspace is beside it as `foo/` (same basename).
 * Addressing is discovered per file via `list` / `query`, then the same write sequence
 * template is specialized with those targets.
 *
 * Options:
 *   --bin <path>           deckuse entry (default: packages/deckuse/dist/bin.js)
 *   --recursive            scan subdirectories for .pptx (dir mode only)
 *   --force                remove existing workspace before init
 *   --continue-on-error    keep going after a failed step / file
 *   --limit <n>            process at most n presentations (dir mode only)
 *   --skip-export          omit final export
 *   --help
 */

import { spawn } from 'node:child_process';
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_BIN = join(ROOT, 'packages/deckuse/dist/bin.js');

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PIXEL_PNG_2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6aAAAAAElFTkSuQmCC',
  'base64',
);

const PREFIX = 'IT';

const usage = () => {
  process.stdout.write(`usage: node scripts/integration-writes.mjs <dir|file.pptx> [options]

Run the full Deckuse write-operation sequence on:
  <dir>         every .pptx under the directory
  <file.pptx>   a single presentation (handy for re-debugging one case)

Workspace for each file is created beside it as <basename>/ (e.g. demo.pptx → demo/).

Options:
  --bin <path>            deckuse bin.js (default: packages/deckuse/dist/bin.js)
  --recursive             include .pptx in subdirectories (dir mode)
  --force                 delete existing workspace before init
  --continue-on-error     do not stop on first failure
  --limit <n>             max presentations to process (dir mode)
  --skip-export           skip final export step
  --help                  show this help
`);
};

const takeFlag = (list, name) => {
  const i = list.indexOf(name);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
};

const takeOption = (list, name) => {
  const i = list.indexOf(name);
  if (i < 0) return undefined;
  const value = list[i + 1];
  list.splice(i, 2);
  return value;
};

const parseArgs = (argv) => {
  const args = [...argv];
  if (takeFlag(args, '--help') || takeFlag(args, '-h')) return { help: true };
  const bin = takeOption(args, '--bin') ?? DEFAULT_BIN;
  const recursive = takeFlag(args, '--recursive');
  const force = takeFlag(args, '--force');
  const continueOnError = takeFlag(args, '--continue-on-error');
  const skipExport = takeFlag(args, '--skip-export');
  const limitRaw = takeOption(args, '--limit');
  const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
  const input = args[0];
  if (!input || args.length > 1) {
    return { error: 'Usage: node scripts/integration-writes.mjs <dir|file.pptx> [options]' };
  }
  if (limitRaw !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return { error: '--limit must be a positive integer' };
  }
  return {
    input: resolve(input),
    bin: resolve(bin),
    recursive,
    force,
    continueOnError,
    skipExport,
    limit,
  };
};

const runDeckuse = (bin, args, stdin = '') =>
  new Promise((done) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: ROOT,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code) => done({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });

const parseEnvelope = (stdout) => {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) throw new Error('deckuse produced no JSON output');
  return JSON.parse(line);
};

/** @typedef {{ name: string; ok: boolean; skipped?: boolean; reason?: string; command?: string; revision?: number; error?: string; ms: number }} StepResult */

class Runner {
  /**
   * @param {string} bin
   * @param {string} workspace
   * @param {{ continueOnError?: boolean }} opts
   */
  constructor(bin, workspace, opts = {}) {
    this.bin = bin;
    this.workspace = workspace;
    this.continueOnError = Boolean(opts.continueOnError);
    /** @type {StepResult[]} */
    this.steps = [];
    this.failed = false;
  }

  wsArgs() {
    return ['--workspace', this.workspace, '--json'];
  }

  /** Human-readable one-line deckuse invocation (workspace/json flags omitted). */
  formatCommand(args) {
    const compact = [];
    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--json' || token === '--quiet') continue;
      if (token === '--workspace') {
        i += 1;
        continue;
      }
      if (token === '--reason') {
        i += 1;
        continue;
      }
      compact.push(token);
    }
    let line = `deckuse ${compact.join(' ')}`;
    if (line.length > 140) line = `${line.slice(0, 137)}...`;
    return line;
  }

  /**
   * @param {StepResult} result
   * @param {string} [detail]
   */
  logStep(result, detail) {
    const n = this.steps.length;
    const status = !result.ok
      ? `FAIL ${result.error ?? 'failed'}`
      : result.skipped
        ? `skip ${result.reason ?? ''}`.trim()
        : `ok${result.revision !== undefined ? ` rev=${String(result.revision)}` : ''} ${String(result.ms)}ms`;
    const what = detail ?? result.command ?? '';
    process.stdout.write(
      `  [${String(n)}] ${result.name}${what ? ` — ${what}` : ''} → ${status}\n`,
    );
  }

  /**
   * Record a skipped logical step (no CLI call) and print one line.
   * @param {string} name
   * @param {string} reason
   */
  skip(name, reason) {
    const result = { name, ok: true, skipped: true, reason, ms: 0 };
    this.steps.push(result);
    this.logStep(result);
  }

  /**
   * @param {string} name
   * @param {string[]} args
   * @param {string} [stdin]
   * @param {{ optional?: boolean }} [opts]
   */
  async step(name, args, stdin = '', opts = {}) {
    const command = this.formatCommand(args);
    if (this.failed && !this.continueOnError) {
      const result = {
        name,
        ok: false,
        skipped: true,
        reason: 'prior step failed',
        command,
        ms: 0,
      };
      this.steps.push(result);
      this.logStep(result, command);
      return null;
    }
    const started = Date.now();
    const result = await runDeckuse(this.bin, args, stdin);
    const ms = Date.now() - started;
    let envelope;
    try {
      envelope = parseEnvelope(result.stdout);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'failed to parse JSON envelope';
      this.failed = true;
      const stepResult = {
        name,
        ok: false,
        command,
        error: `${message}; stderr=${result.stderr.trim() || '(empty)'}`,
        ms,
      };
      this.steps.push(stepResult);
      this.logStep(stepResult, command);
      return null;
    }
    if (!envelope.ok) {
      const errMsg = envelope.error
        ? `${envelope.error.code}: ${envelope.error.message}`
        : `exit ${String(result.code)}`;
      if (opts.optional) {
        const stepResult = {
          name,
          ok: true,
          skipped: true,
          reason: errMsg,
          command,
          ms,
        };
        this.steps.push(stepResult);
        this.logStep(stepResult, command);
        return envelope;
      }
      this.failed = true;
      const stepResult = {
        name,
        ok: false,
        command,
        error: errMsg,
        ms,
      };
      this.steps.push(stepResult);
      this.logStep(stepResult, command);
      return envelope;
    }
    const stepResult = {
      name,
      ok: true,
      command,
      revision: typeof envelope.revision === 'number' ? envelope.revision : undefined,
      ms,
    };
    this.steps.push(stepResult);
    this.logStep(stepResult, command);
    return envelope;
  }

  async listSlides() {
    const envelope = await this.step('list slides', ['list', 'slides', ...this.wsArgs()]);
    const items = envelope?.data?.items;
    return Array.isArray(items) ? items : [];
  }

  async listShapes(slide) {
    const envelope = await this.step(`list shapes slide:${String(slide)}`, [
      'list',
      'shapes',
      '--slide',
      String(slide),
      ...this.wsArgs(),
    ]);
    const items = envelope?.data?.items;
    return Array.isArray(items) ? items : [];
  }

  async query(selector, name) {
    const envelope = await this.step(name ?? `query ${selector}`, [
      'query',
      this.workspace,
      selector,
      '--limit',
      '200',
      '--json',
    ]);
    return Array.isArray(envelope?.data) ? envelope.data : [];
  }

  /**
   * Refresh inventory used to specialize the write template.
   * @param {number[]} slideIndexes
   */
  async inventory(slideIndexes) {
    /** @type {Array<{ target: string; id?: string | number; name?: string; kind?: string; textPreview?: string; slide: number }>} */
    const shapes = [];
    for (const slide of slideIndexes) {
      const items = await this.listShapes(slide);
      for (const item of items) {
        shapes.push({ ...item, slide });
      }
    }
    const byKind = (kind) => shapes.filter((s) => s.kind === kind);
    const withText = shapes.filter(
      (s) => typeof s.textPreview === 'string' && s.textPreview.trim().length > 0,
    );
    const findByName = (name) => shapes.find((s) => s.name === name);
    return {
      shapes,
      withText,
      textShape: withText[0] ?? shapes.find((s) => s.kind === 'textbox' || s.kind === 'shape'),
      pictures: byKind('picture'),
      tables: byKind('table'),
      charts: byKind('chart'),
      findByName,
    };
  }
}

const isPptx = (name) => name.toLowerCase().endsWith('.pptx') && !name.startsWith('.');

const isInsideWorkspace = async (filePath) => {
  let dir = dirname(filePath);
  for (;;) {
    try {
      await access(join(dir, '.deckuse', 'manifest.json'));
      return true;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return false;
      dir = parent;
    }
  }
};

const collectPptx = async (dir, recursive) => {
  /** @type {string[]} */
  const found = [];
  const walk = async (current) => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        try {
          await access(join(full, '.deckuse', 'manifest.json'));
          continue; // skip existing workspaces
        } catch {
          if (recursive) await walk(full);
        }
      } else if (entry.isFile() && isPptx(entry.name)) {
        if (entry.name === 'package.pptx') continue;
        if (await isInsideWorkspace(full)) continue;
        found.push(full);
      }
    }
  };
  await walk(dir);
  found.sort();
  return found;
};

const ensureMedia = async (mediaDir) => {
  await mkdir(mediaDir, { recursive: true });
  const image = join(mediaDir, 'pixel.png');
  const image2 = join(mediaDir, 'pixel2.png');
  const video = join(mediaDir, 'clip.mp4');
  const audio = join(mediaDir, 'track.mp3');
  await writeFile(image, PIXEL_PNG);
  await writeFile(image2, PIXEL_PNG_2);
  await writeFile(video, Buffer.from('fake-mp4-bytes'));
  await writeFile(audio, Buffer.from('fake-mp3-bytes'));
  return { image, image2, video, audio };
};

const targetId = (shape) => {
  if (!shape?.target || typeof shape.target !== 'string') return undefined;
  return shape.target;
};

/**
 * Build and execute the shared write sequence, specializing addresses from inventory.
 * @param {Runner} runner
 * @param {{ image: string; image2: string; video: string; audio: string }} media
 * @param {{ skipExport?: boolean }} opts
 */
const runWriteSequence = async (runner, media, opts = {}) => {
  const slides = await runner.listSlides();
  let slideIndexes = slides
    .map((s) => (typeof s.index === 'number' ? s.index : undefined))
    .filter((n) => typeof n === 'number');
  if (slideIndexes.length === 0) {
    await runner.step('add slide (empty deck)', [
      'add',
      'slide',
      '--layout',
      'blank',
      '--name',
      `${PREFIX}-bootstrap`,
      ...runner.wsArgs(),
    ]);
    slideIndexes = [1];
  }

  const workSlide = slideIndexes[0];
  const workSlideMeta = slides.find((s) => s.index === workSlide);
  const workSlidePart =
    typeof workSlideMeta?.partUri === 'string'
      ? workSlideMeta.partUri
      : `/ppt/slides/slide${String(workSlide)}.xml`;
  let inv = await runner.inventory(slideIndexes);

  // --- mutate existing content when present ---
  const existingText = inv.textShape;
  if (existingText?.target) {
    const sample = (existingText.textPreview ?? 'X').slice(0, 24);
    await runner.step('set text (existing)', [
      'set',
      'text',
      existingText.target,
      '--value',
      `${PREFIX} existing text`,
      '--reason',
      'integration-writes',
      ...runner.wsArgs(),
    ]);
    await runner.step('set properties (existing)', [
      'set',
      existingText.target,
      '--font.size',
      '28',
      '--font.weight',
      'bold',
      '--font.color',
      '#1A1A1A',
      '--fill.color',
      '#F5F5F5',
      '--line.color',
      '#4472C4',
      '--line.width',
      '12700',
      '--paragraph.align',
      'ctr',
      '--hyperlink',
      'https://example.com/integration-writes',
      '--reason',
      'integration-writes',
      ...runner.wsArgs(),
    ]);
    await runner.step(
      'clear hyperlink (existing via apply)',
      ['apply', runner.workspace, '--input', '-', '--json'],
      JSON.stringify({
        type: 'setProperties',
        target: existingText.target,
        properties: { hyperlink: null },
      }),
    );
    await runner.step('xfrm set (existing)', [
      'xfrm',
      'set',
      '--target',
      existingText.target,
      '--rotation',
      '0',
      '--reason',
      'integration-writes',
      ...runner.wsArgs(),
    ]);
    if (sample.trim()) {
      await runner.step('replace-text (existing sample)', [
        'replace-text',
        '--source',
        `${PREFIX} existing`,
        '--target',
        `${PREFIX} replaced`,
        '--limit',
        '20',
        '--reason',
        'integration-writes',
        ...runner.wsArgs(),
      ]);
    }
  } else {
    runner.skip('mutate existing text shape', 'no text-bearing shape on deck');
  }

  if (inv.shapes.length >= 2) {
    const a = inv.shapes[0];
    const b = inv.shapes[1];
    if (a?.target && b?.target) {
      await runner.step('z move --to-front (existing)', [
        'z',
        'move',
        a.target,
        '--to-front',
        '--reason',
        'integration-writes',
        ...runner.wsArgs(),
      ]);
      await runner.step('z move --below (existing)', [
        'z',
        'move',
        a.target,
        '--below',
        b.target,
        '--reason',
        'integration-writes',
        ...runner.wsArgs(),
      ]);
    }
  }

  const existingTable = inv.tables[0];
  if (existingTable?.target) {
    await runner.step(
      'table insertRow (existing via apply)',
      ['apply', runner.workspace, '--input', '-', '--json'],
      JSON.stringify({
        type: 'setProperties',
        target: existingTable.target,
        properties: { insertRow: { index: 0, cells: [`${PREFIX}-row`] } },
      }),
    );
    await runner.step(
      'table insertColumn (existing via apply)',
      ['apply', runner.workspace, '--input', '-', '--json'],
      JSON.stringify({
        type: 'setProperties',
        target: existingTable.target,
        properties: { insertColumn: { index: 0 } },
      }),
    );
  }

  const existingChart = inv.charts[0];
  if (existingChart?.target) {
    await runner.step('set chart props (existing)', [
      'set',
      existingChart.target,
      '--title',
      `${PREFIX} Chart`,
      '--gapWidth',
      '120',
      '--showMajorGridlines',
      'true',
      '--reason',
      'integration-writes',
      ...runner.wsArgs(),
    ]);
  }

  const existingPicture = inv.pictures[0];
  if (existingPicture?.target) {
    await runner.step(
      'replacePicture (existing via apply)',
      ['apply', runner.workspace, '--input', '-', '--json'],
      JSON.stringify({
        type: 'replacePicture',
        target: existingPicture.target,
        path: media.image2,
      }),
    );
  }

  await runner.step(
    'setText notes (optional)',
    [
      'set',
      'text',
      `slide:${String(workSlide)}/notes`,
      '--value',
      `${PREFIX} speaker notes`,
      '--reason',
      'integration-writes',
      ...runner.wsArgs(),
    ],
    '',
    { optional: true },
  );

  // --- add slide + all shape kinds (deterministic names) ---
  await runner.step('add slide', [
    'add',
    'slide',
    '--after',
    String(workSlide),
    '--layout',
    'blank',
    '--name',
    `${PREFIX}-slide`,
    '--reason',
    'integration-writes',
    ...runner.wsArgs(),
  ]);

  const addSlide = workSlide; // keep adding onto original first slide for density
  const geometry = ['--x', '914400', '--y', '914400', '--width', '1828800', '--height', '914400'];

  const addShape = async (type, name, extra = []) => {
    await runner.step(`add shape ${type}`, [
      'add',
      'shape',
      '--slide',
      String(addSlide),
      '--type',
      type,
      '--name',
      name,
      ...geometry,
      ...extra,
      '--reason',
      'integration-writes',
      ...runner.wsArgs(),
    ]);
  };

  await addShape('text', `${PREFIX}-text`, ['--text', `${PREFIX} hello`]);
  await addShape('rect', `${PREFIX}-rect`);
  await addShape('rounded-rect', `${PREFIX}-rounded`);
  await addShape('ellipse', `${PREFIX}-ellipse`);
  await addShape('line', `${PREFIX}-line`);
  await addShape('group', `${PREFIX}-group`);
  await addShape('image', `${PREFIX}-image`, ['--file', media.image]);
  await addShape('table', `${PREFIX}-table`, [
    '--rows',
    JSON.stringify([
      ['A', 'B'],
      ['1', '2'],
    ]),
  ]);
  await addShape('chart', `${PREFIX}-chart`, [
    '--chart-type',
    'column',
    '--data',
    JSON.stringify({
      title: `${PREFIX} Revenue`,
      categories: ['Q1', 'Q2'],
      series: [{ name: '2024', values: [10, 20], color: '#5B8DEF' }],
    }),
  ]);
  await addShape('video', `${PREFIX}-video`, ['--file', media.video]);
  await addShape('audio', `${PREFIX}-audio`, ['--file', media.audio]);

  // re-discover after adds
  const slidesAfter = await runner.listSlides();
  const indexesAfter = slidesAfter
    .map((s) => (typeof s.index === 'number' ? s.index : undefined))
    .filter((n) => typeof n === 'number');
  inv = await runner.inventory(indexesAfter.length ? indexesAfter : [addSlide]);

  const addedText = inv.findByName(`${PREFIX}-text`);
  const addedRect = inv.findByName(`${PREFIX}-rect`);
  const addedEllipse = inv.findByName(`${PREFIX}-ellipse`);
  const addedImage = inv.findByName(`${PREFIX}-image`);
  const addedTable = inv.findByName(`${PREFIX}-table`);
  const addedChart = inv.findByName(`${PREFIX}-chart`);
  const addedLine = inv.findByName(`${PREFIX}-line`);
  const addedGroup = inv.findByName(`${PREFIX}-group`);

  if (addedText?.target) {
    await runner.step('set text (added)', [
      'set',
      'text',
      addedText.target,
      '--value',
      `${PREFIX} updated`,
      '--reason',
      'integration-writes',
      ...runner.wsArgs(),
    ]);
    await runner.step('set font/fill (added)', [
      'set',
      addedText.target,
      '--font.size',
      '32',
      '--font.family',
      'Arial',
      '--font.italic',
      'true',
      '--fill.color',
      '#0A2930',
      '--font.color',
      '#FFFFFF',
      '--paragraph.level',
      '0',
      '--bullet',
      'true',
      '--name',
      `${PREFIX}-text-renamed`,
      '--reason',
      'integration-writes',
      ...runner.wsArgs(),
    ]);
    await runner.step('xfrm set (added)', [
      'xfrm',
      'set',
      '--target',
      addedText.target,
      '--x',
      '457200',
      '--y',
      '457200',
      '--width',
      '2743200',
      '--height',
      '914400',
      '--rotation',
      '5',
      '--reason',
      'integration-writes',
      ...runner.wsArgs(),
    ]);
  }

  if (addedText?.target && addedRect?.target) {
    await runner.step('z move --above (added)', [
      'z',
      'move',
      addedText.target,
      '--above',
      addedRect.target,
      '--reason',
      'integration-writes',
      ...runner.wsArgs(),
    ]);
    await runner.step('z move --to-back (added)', [
      'z',
      'move',
      addedRect.target,
      '--to-back',
      '--reason',
      'integration-writes',
      ...runner.wsArgs(),
    ]);
  }

  if (addedEllipse?.target) {
    await runner.step(
      'setTransform (added via apply)',
      ['apply', runner.workspace, '--input', '-', '--json'],
      JSON.stringify({
        type: 'setTransform',
        target: addedEllipse.target,
        transform: { x: 100000, y: 100000, width: 914400, height: 914400, rotation: 15 },
      }),
    );
  }

  // legacy add (ElementRef parent) — still a supported write path
  await runner.step(
    'legacy add textbox (via apply)',
    ['apply', runner.workspace, '--input', '-', '--json'],
    JSON.stringify({
      type: 'add',
      parent: { documentId: runner.workspace, path: workSlidePart },
      element: { kind: 'textbox', text: `${PREFIX} legacy`, name: `${PREFIX}-legacy` },
    }),
  );

  if (addedTable?.target) {
    await runner.step(
      'table insertRow (added)',
      ['apply', runner.workspace, '--input', '-', '--json'],
      JSON.stringify({
        type: 'setProperties',
        target: addedTable.target,
        properties: { insertRow: { index: 1, cells: ['X', 'Y'] } },
      }),
    );
    await runner.step(
      'table insertColumn (added)',
      ['apply', runner.workspace, '--input', '-', '--json'],
      JSON.stringify({
        type: 'setProperties',
        target: addedTable.target,
        properties: { insertColumn: { index: 1 } },
      }),
    );
    await runner.step(
      'table deleteRow (added)',
      ['apply', runner.workspace, '--input', '-', '--json'],
      JSON.stringify({
        type: 'setProperties',
        target: addedTable.target,
        properties: { deleteRow: { index: 2 } },
      }),
    );
    await runner.step(
      'table deleteColumn (added)',
      ['apply', runner.workspace, '--input', '-', '--json'],
      JSON.stringify({
        type: 'setProperties',
        target: addedTable.target,
        properties: { deleteColumn: { index: 2 } },
      }),
    );

    const cells = await runner.query('kind=tableCell', 'query tableCell');
    const cell = cells.find(
      (c) =>
        c?.location?.tableId !== undefined ||
        (typeof c?.ref?.elementId === 'string' && c.ref.elementId.includes(':cell:')),
    );
    if (cell?.ref) {
      await runner.step(
        'tableCell fill (added via apply)',
        ['apply', runner.workspace, '--input', '-', '--json'],
        JSON.stringify({
          type: 'setProperties',
          ref: cell.ref,
          properties: { fill: 'FFCC00' },
        }),
      );
    } else {
      runner.skip('tableCell fill (added via apply)', 'no tableCell in query results');
    }
  }

  if (addedChart?.target) {
    await runner.step('set chart series (added)', [
      'set',
      addedChart.target,
      '--title',
      `${PREFIX} Updated`,
      '--textColor',
      '#333333',
      '--gapWidth',
      '80',
      '--showMajorGridlines',
      'true',
      '--series',
      JSON.stringify([
        { name: '2025', values: [15, 25], color: '#E67E22' },
      ]),
      '--reason',
      'integration-writes',
      ...runner.wsArgs(),
    ]);
  }

  if (addedImage?.target) {
    await runner.step(
      'replacePicture (added)',
      ['apply', runner.workspace, '--input', '-', '--json'],
      JSON.stringify({
        type: 'replacePicture',
        target: addedImage.target,
        path: media.image2,
      }),
    );
  }

  const dupTarget = targetId(addedText) ?? targetId(addedRect);
  if (dupTarget) {
    await runner.step(
      'duplicate (added via apply)',
      ['apply', runner.workspace, '--input', '-', '--json'],
      JSON.stringify({ type: 'duplicate', target: dupTarget }),
    );
  }

  // disposable removes: only IT-owned shapes
  const removeTarget = targetId(addedGroup) ?? targetId(addedLine);
  if (removeTarget) {
    await runner.step('remove shape (added disposable)', [
      'remove',
      removeTarget,
      '--reason',
      'integration-writes',
      ...runner.wsArgs(),
    ]);
  }

  // batch / applyTransaction covering leftover write types
  const batchTarget = targetId(inv.findByName(`${PREFIX}-text-renamed`)) ?? targetId(addedText);
  if (batchTarget) {
    await runner.step(
      'apply batch setText+set',
      ['apply', runner.workspace, '--input', '-', '--json'],
      JSON.stringify([
        { type: 'setText', target: batchTarget, text: `${PREFIX} batch` },
        {
          type: 'set',
          target: batchTarget,
          properties: { 'font.size': 24, 'fill.color': '#EEEEEE' },
        },
      ]),
    );
    await runner.step(
      'applyTransaction set-text',
      ['apply', runner.workspace, '--input', '-', '--json'],
      JSON.stringify({
        operations: [
          { op: 'set-text', target: batchTarget, value: `${PREFIX} txn` },
          { op: 'set', target: batchTarget, 'font.size': 22 },
        ],
      }),
    );
  }

  await runner.step('add slide then remove it', [
    'add',
    'slide',
    '--layout',
    'blank',
    '--name',
    `${PREFIX}-to-remove`,
    '--reason',
    'integration-writes',
    ...runner.wsArgs(),
  ]);
  const slidesForRemove = await runner.listSlides();
  // addSlide appends when --after is omitted; name is not always indexed — remove the last slide.
  const removable = slidesForRemove.at(-1);
  if (removable?.target && slidesForRemove.length > 1) {
    await runner.step('remove slide (added)', [
      'remove',
      removable.target,
      '--reason',
      'integration-writes',
      ...runner.wsArgs(),
    ]);
  } else {
    runner.skip(
      'remove slide (added)',
      'need at least two slides to safely remove the appended one',
    );
  }

  await runner.step('validate', [
    'validate',
    '--package',
    '--relationships',
    ...runner.wsArgs(),
  ]);
  await runner.step('history', ['history', '--limit', '50', ...runner.wsArgs()]);

  if (!opts.skipExport) {
    const out = join(runner.workspace, 'out-integration.pptx');
    await runner.step('export', ['export', out, ...runner.wsArgs()]);
  }

  // undo last write (after export) to exercise undo without losing the exported artifact
  await runner.step('undo', ['undo', '--steps', '1', ...runner.wsArgs()]);

  return {
    slides: indexesAfter.length,
    shapesSeen: inv.shapes.length,
  };
};

const processOne = async (pptxPath, options) => {
  const base = basename(pptxPath, extname(pptxPath));
  const workspace = join(dirname(pptxPath), base);
  const label = basename(pptxPath);

  process.stdout.write(`\n=== ${label} → ${workspace}\n`);

  try {
    await access(options.bin);
  } catch {
    throw new Error(`deckuse bin not found: ${options.bin} (run pnpm build first)`);
  }

  if (options.force) {
    await rm(workspace, { recursive: true, force: true });
  } else {
    try {
      await access(join(workspace, '.deckuse', 'manifest.json'));
      throw new Error(
        `workspace already exists: ${workspace} (pass --force to recreate)`,
      );
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes('workspace already exists')) throw cause;
    }
  }

  const mediaDir = join(workspace, '.integration-media');
  const media = await ensureMedia(mediaDir);
  const runner = new Runner(options.bin, workspace, {
    continueOnError: options.continueOnError,
  });

  const init = await runner.step('init', [
    'init',
    pptxPath,
    workspace,
    '--json',
  ]);
  if (!init?.ok && !options.continueOnError) {
    return { pptx: pptxPath, workspace, ok: false, steps: runner.steps };
  }

  let summary = {};
  try {
    summary = await runWriteSequence(runner, media, { skipExport: options.skipExport });
  } catch (cause) {
    runner.failed = true;
    const stepResult = {
      name: 'sequence',
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
      ms: 0,
    };
    runner.steps.push(stepResult);
    runner.logStep(stepResult);
  }

  const ok = !runner.failed && runner.steps.every((s) => s.ok);
  const report = {
    ok,
    pptx: pptxPath,
    workspace,
    startedAt: new Date().toISOString(),
    summary,
    steps: runner.steps,
    failedSteps: runner.steps.filter((s) => !s.ok),
  };
  await mkdir(workspace, { recursive: true });
  await writeFile(
    join(workspace, 'integration-writes-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const passed = runner.steps.filter((s) => s.ok && !s.skipped).length;
  const skipped = runner.steps.filter((s) => s.skipped).length;
  const failed = runner.steps.filter((s) => !s.ok).length;
  process.stdout.write(
    `  → ${ok ? 'PASS' : 'FAIL'}  passed=${String(passed)} skipped=${String(skipped)} failed=${String(failed)}\n`,
  );
  for (const step of runner.steps.filter((s) => !s.ok)) {
    process.stdout.write(`     ✗ ${step.name}: ${step.error ?? step.reason ?? 'failed'}\n`);
  }
  return report;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (options.error) {
    process.stderr.write(`${options.error}\n`);
    usage();
    process.exitCode = 2;
    return;
  }

  const st = await stat(options.input).catch(() => null);
  if (!st) {
    process.stderr.write(`Path not found: ${options.input}\n`);
    process.exitCode = 2;
    return;
  }

  /** @type {string[]} */
  let files;
  /** Directory used for the batch summary file (parent of a single .pptx, or the scan root). */
  let summaryDir;
  if (st.isFile()) {
    if (!isPptx(basename(options.input))) {
      process.stderr.write(`Not a .pptx file: ${options.input}\n`);
      process.exitCode = 2;
      return;
    }
    if (await isInsideWorkspace(options.input)) {
      process.stderr.write(
        `Refusing to run on a package inside an existing workspace: ${options.input}\n`,
      );
      process.exitCode = 2;
      return;
    }
    files = [options.input];
    summaryDir = dirname(options.input);
    process.stdout.write(`integration-writes: single file ${options.input}\n`);
  } else if (st.isDirectory()) {
    files = await collectPptx(options.input, options.recursive);
    if (options.limit !== undefined) files = files.slice(0, options.limit);
    if (files.length === 0) {
      process.stderr.write(`No .pptx files found under ${options.input}\n`);
      process.exitCode = 1;
      return;
    }
    summaryDir = options.input;
    process.stdout.write(
      `integration-writes: ${String(files.length)} file(s) under ${options.input}\n`,
    );
  } else {
    process.stderr.write(`Not a file or directory: ${options.input}\n`);
    process.exitCode = 2;
    return;
  }

  /** @type {Awaited<ReturnType<typeof processOne>>[]} */
  const reports = [];
  for (const file of files) {
    try {
      const report = await processOne(file, options);
      reports.push(report);
      if (!report.ok && !options.continueOnError) break;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      process.stdout.write(`  → FAIL  ${message}\n`);
      reports.push({
        ok: false,
        pptx: file,
        workspace: join(dirname(file), basename(file, extname(file))),
        error: message,
        steps: [],
      });
      if (!options.continueOnError) break;
    }
  }

  const summaryPath = join(summaryDir, 'integration-writes-summary.json');
  const summary = {
    ok: reports.every((r) => r.ok),
    input: options.input,
    total: reports.length,
    passed: reports.filter((r) => r.ok).length,
    failed: reports.filter((r) => !r.ok).length,
    files: reports.map((r) => ({
      pptx: r.pptx,
      workspace: r.workspace,
      ok: r.ok,
      failedSteps: (r.failedSteps ?? []).map((s) => s.name),
      error: r.error,
    })),
  };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(
    `\nSummary: ${String(summary.passed)}/${String(summary.total)} passed → ${summaryPath}\n`,
  );
  if (!summary.ok) process.exitCode = 1;
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
