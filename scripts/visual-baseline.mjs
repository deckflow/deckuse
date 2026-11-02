#!/usr/bin/env node
// Build controlled native chart specimens and optionally record native Office PDF output.
import { readFile, mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../dist/index.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(
  process.argv.find((a) => a.startsWith('--output='))?.slice(9) ??
    join(root, '.tmp/visual-baseline'),
);
await mkdir(output, { recursive: true });
const workspace = join(await mkdtemp(join(tmpdir(), 'deckuse-visual-')), 'ws');
const cases = JSON.parse(await readFile(join(root, 'test/fixtures/visual/cases.json'), 'utf8'));
const invoke = async (command) => {
  const result = await runCommand({ version: '2.0', workspaceId: workspace, ...command });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result;
};
await invoke({ type: 'init', source: join(root, 'assets/default.pptx'), format: 'pptx' });
const operations = [];
for (const [i, item] of cases.entries()) {
  if (i) operations.push({ type: 'addSlide', layout: 'Blank' });
  const { name, title, categories, series, ...props } = item;
  operations.push({
    type: 'addShape',
    slide: i + 1,
    shapeType: 'chart',
    name,
    x: '8%',
    y: '12%',
    width: '84%',
    height: '76%',
    ...props,
    data: { title, categories, series },
  });
}
await invoke({
  type: 'batch',
  transactionId: '1',
  commands: operations.map((op) => ({
    version: '2.0',
    workspaceId: workspace,
    transactionId: '1',
    ...op,
  })),
});
const input = join(output, 'charts.pptx');
await invoke({ type: 'export', output: input, profile: 'delivery' });
const validation = await invoke({ type: 'validate', render: true, level: 'full' });
const evidence = {
  inputSha256: createHash('sha256')
    .update(await readFile(input))
    .digest('hex'),
  platform: process.platform,
  nativeOpen: 'unverified',
  nativeRender: 'unverified',
  nativeVisual: 'unverified',
  cases,
  validation,
  note: 'No baseline is a visual pass until a human/agent has inspected native rendered pages.',
};
if (process.argv.includes('--native')) {
  try {
    const script = `on run argv
set inputPath to item 1 of argv
set outputPath to item 2 of argv
tell application "Microsoft PowerPoint"
with timeout of 30 seconds
open (POSIX file inputPath)
set p to active presentation
try
save p in (POSIX file outputPath) as save as PDF
close p saving no
on error msg number num
try
close p saving no
end try
error msg number num
end try
return version
end timeout
end tell
end run`;
    const scriptPath = join(output, 'native-render.applescript');
    await writeFile(scriptPath, script);
    const result = await promisify(execFile)(
      'osascript',
      [scriptPath, input, join(output, 'powerpoint.pdf')],
      { timeout: 45000, maxBuffer: 1024 * 1024 },
    );
    const pdf = await readFile(join(output, 'powerpoint.pdf'));
    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-')))
      throw new Error('Native export did not produce PDF');
    evidence.nativeOpen = 'passed';
    evidence.nativeRender = 'passed';
    evidence.powerPointVersion = result.stdout.trim();
    evidence.pdfSha256 = createHash('sha256').update(pdf).digest('hex');
  } catch (cause) {
    evidence.nativeFailure = cause.message;
  }
}
await writeFile(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(
  JSON.stringify({
    output,
    nativeOpen: evidence.nativeOpen,
    nativeRender: evidence.nativeRender,
    nativeFailure: evidence.nativeFailure,
  }),
);
